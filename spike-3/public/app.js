"use strict";
(() => {
  // src/config.ts
  var oauthConfig = {
    clientId: "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com"
  };
  var adminConfig = {
    sourceRootFolderId: "1BOVZer9jAPNhHS7syxLf99n9Tf-27B4O",
    destinationManifestFolderId: "10Px9dQKe2WeBl1YGf1BHafs5C4MicfWq",
    manifestFilename: "spike-3-manifest.csv"
  };

  // src/auth.ts
  var GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
  var USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
  var SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive"
  ];
  function loadGisScriptOnce() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services script.")), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GIS_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
      document.head.appendChild(script);
    });
  }
  async function fetchUserEmail(accessToken) {
    const res = await fetch(USERINFO_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!res.ok) return void 0;
    const data = await res.json();
    return data.email;
  }
  async function runBrowserAuth() {
    await loadGisScriptOnce();
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: oauthConfig.clientId,
      scope: SCOPES.join(" "),
      callback: () => {
      }
    });
    const token = await new Promise((resolve) => {
      tokenClient.callback = (resp) => resolve(resp);
      tokenClient.requestAccessToken({ prompt: "consent" });
    });
    if (token.error) {
      const desc = token.error_description ? `: ${token.error_description}` : "";
      throw new Error(`OAuth token request failed: ${token.error}${desc}`);
    }
    const accessToken = token.access_token;
    const expiresIn = token.expires_in;
    if (!accessToken || !expiresIn) {
      throw new Error("OAuth token request returned no access_token/expires_in.");
    }
    const email = await fetchUserEmail(accessToken);
    return { accessToken, expiresIn, email };
  }

  // src/drive.ts
  var FOLDER_MIME = "application/vnd.google-apps.folder";
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Drive API error ${res.status}: ${res.statusText}. Body: ${bodyText}`);
    }
    return bodyText ? JSON.parse(bodyText) : {};
  }
  async function listFolderOnce(accessToken, folderId, pageToken) {
    const fields = [
      "nextPageToken",
      "files(id,name,mimeType,parents,owners(emailAddress),driveId,trashed,shortcutDetails(targetId,targetMimeType),permissions(emailAddress,role,type),createdTime,modifiedTime)"
    ].join(",");
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      fields
    });
    if (pageToken) params.set("pageToken", pageToken);
    const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
    const page = await fetchJson(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return {
      items: page.files ?? [],
      nextPageToken: page.nextPageToken
    };
  }
  async function enumerateTree(accessToken, rootFolderId, onPage) {
    const all = [];
    const queue = [rootFolderId];
    while (queue.length > 0) {
      const folderId = queue.shift();
      let pageToken;
      let pageIndex = 0;
      do {
        const page = await listFolderOnce(accessToken, folderId, pageToken);
        all.push(...page.items);
        for (const item of page.items) {
          if (item.mimeType === FOLDER_MIME && item.id) {
            queue.push(item.id);
          }
        }
        pageIndex += 1;
        if (onPage) onPage({ folderId, items: page.items.length, page: pageIndex });
        pageToken = page.nextPageToken;
      } while (pageToken);
    }
    return all;
  }
  async function uploadCsvToDrive(accessToken, destinationFolderId, filename, csvContent) {
    const boundary = "-------drive-spike-3-" + Math.random().toString(16).slice(2);
    const delimiter = `--${boundary}`;
    const closeDelimiter = `--${boundary}--`;
    const metadata = {
      name: filename,
      parents: [destinationFolderId],
      mimeType: "text/csv"
    };
    const body = [
      delimiter,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      delimiter,
      "Content-Type: text/csv; charset=UTF-8",
      "",
      csvContent,
      closeDelimiter,
      ""
    ].join("\r\n");
    const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to upload CSV: ${res.status} ${res.statusText}. Body: ${bodyText}`);
    }
    const json = bodyText ? JSON.parse(bodyText) : {};
    if (!json.id) {
      throw new Error("Upload succeeded but response missing file id.");
    }
    return json.id;
  }

  // src/csv.ts
  var HEADERS = [
    "id",
    "name",
    "mimeType",
    "parents",
    "owners",
    "driveId",
    "trashed",
    "shortcut_target_id",
    "shortcut_target_mimeType",
    "permissions",
    "createdTime",
    "modifiedTime"
  ];
  function csvEscape(value) {
    const needsQuotes = value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");
    if (!needsQuotes) return value;
    return `"${value.replace(/"/g, '""')}"`;
  }
  function formatOwners(item) {
    return (item.owners ?? []).map((o) => o.emailAddress).filter((e) => !!e).join(";");
  }
  function formatParents(item) {
    return (item.parents ?? []).join(";");
  }
  function formatPermissions(item) {
    const perms = (item.permissions ?? []).map((p) => ({
      type: p.type,
      role: p.role,
      emailAddress: p.emailAddress
    }));
    return perms.length > 0 ? JSON.stringify(perms) : "";
  }
  function renderCsv(items2) {
    const lines = [];
    lines.push(HEADERS.join(","));
    for (const item of items2) {
      const row = [];
      row.push(item.id ?? "");
      row.push(item.name ?? "");
      row.push(item.mimeType ?? "");
      row.push(formatParents(item));
      row.push(formatOwners(item));
      row.push(item.driveId ?? "");
      row.push(item.trashed ? "true" : "false");
      row.push(item.shortcutDetails?.targetId ?? "");
      row.push(item.shortcutDetails?.targetMimeType ?? "");
      row.push(formatPermissions(item));
      row.push(item.createdTime ?? "");
      row.push(item.modifiedTime ?? "");
      lines.push(row.map((v) => csvEscape(v)).join(","));
    }
    return lines.join("\n");
  }

  // src/app.ts
  var auth = null;
  var items = [];
  function byId(id) {
    return document.getElementById(id);
  }
  function setStatus(message) {
    const el = byId("status");
    if (el) el.textContent = message;
  }
  function appendLog(message) {
    const el = byId("log");
    if (!el) return;
    el.textContent += message + "\n";
    el.scrollTop = el.scrollHeight;
  }
  function setRunning(running) {
    const buttons = [
      "auth",
      "enumerate",
      "download",
      "upload"
    ].map((id) => byId(id)).filter((b) => !!b);
    buttons.forEach((b) => b.disabled = running);
  }
  function summarise(items2) {
    let folders = 0;
    let files = 0;
    let shortcuts = 0;
    const multiParent = [];
    for (const item of items2) {
      if (item.mimeType === "application/vnd.google-apps.folder") {
        folders += 1;
      } else if (item.shortcutDetails) {
        shortcuts += 1;
        files += 1;
      } else {
        files += 1;
      }
      if ((item.parents?.length ?? 0) > 1) {
        multiParent.push(item);
      }
    }
    return { folders, files, shortcuts, multiParent };
  }
  function showSummary(items2) {
    const summary = summarise(items2);
    const el = byId("summary");
    if (!el) return;
    el.innerHTML = `
    <div><strong>Total items:</strong> ${items2.length}</div>
    <div><strong>Folders:</strong> ${summary.folders}</div>
    <div><strong>Files (incl. shortcuts):</strong> ${summary.files}</div>
    <div><strong>Shortcuts:</strong> ${summary.shortcuts}</div>
    <div><strong>Multi-parent items:</strong> ${summary.multiParent.length}</div>
  `;
    const multi = byId("multiparent");
    if (multi) {
      if (summary.multiParent.length === 0) {
        multi.textContent = "(none)";
      } else {
        const lines = summary.multiParent.map((m) => `${m.id} :: ${m.name ?? "(unnamed)"} :: parents=${(m.parents ?? []).join(";")}`);
        multi.textContent = lines.join("\n");
      }
    }
  }
  function ensureAuth() {
    if (!auth) {
      throw new Error("Authenticate first.");
    }
  }
  async function handleAuth() {
    setRunning(true);
    setStatus("Authorising with Google...");
    appendLog("Starting OAuth...");
    try {
      auth = await runBrowserAuth();
      setStatus(`Authenticated as ${auth.email ?? "unknown user"}. Token expires in ${auth.expiresIn}s.`);
      appendLog(`Auth OK. Email: ${auth.email ?? "unknown"}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      appendLog("Auth failed.");
    } finally {
      setRunning(false);
    }
  }
  async function handleEnumerate() {
    setRunning(true);
    setStatus("Enumerating...");
    appendLog("Starting enumeration...");
    items = [];
    try {
      ensureAuth();
      const root = adminConfig.sourceRootFolderId;
      if (!root || root.startsWith("REPLACE_WITH")) {
        throw new Error("Configure sourceRootFolderId first.");
      }
      items = await enumerateTree(auth.accessToken, root, ({ folderId, items: items2, page }) => {
        appendLog(`Folder ${folderId}: page ${page}, ${items2} items`);
      });
      setStatus(`Done. Collected ${items.length} entries.`);
      appendLog("Enumeration complete.");
      showSummary(items);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      appendLog("Enumeration failed.");
    } finally {
      setRunning(false);
    }
  }
  function handleDownload() {
    if (items.length === 0) {
      setStatus("Nothing to download. Run enumeration first.");
      return;
    }
    const csv = renderCsv(items);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = adminConfig.manifestFilename || "manifest.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("CSV downloaded.");
  }
  async function handleUpload() {
    setRunning(true);
    try {
      ensureAuth();
      if (items.length === 0) throw new Error("Nothing to upload. Run enumeration first.");
      const csv = renderCsv(items);
      const dest = adminConfig.destinationManifestFolderId;
      if (!dest || dest.startsWith("REPLACE_WITH")) {
        throw new Error("Configure destinationManifestFolderId first.");
      }
      setStatus("Uploading CSV to Drive...");
      const fileId = await uploadCsvToDrive(auth.accessToken, dest, adminConfig.manifestFilename, csv);
      setStatus(`Uploaded manifest to Drive. File ID: ${fileId}`);
      appendLog(`Upload OK. File ID: ${fileId}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
      appendLog("Upload failed.");
    } finally {
      setRunning(false);
    }
  }
  function init() {
    byId("auth")?.addEventListener("click", () => void handleAuth());
    byId("enumerate")?.addEventListener("click", () => void handleEnumerate());
    byId("download")?.addEventListener("click", () => handleDownload());
    byId("upload")?.addEventListener("click", () => void handleUpload());
    const cfg = byId("config");
    if (cfg) {
      cfg.textContent = JSON.stringify(
        {
          sourceRootFolderId: adminConfig.sourceRootFolderId,
          destinationManifestFolderId: adminConfig.destinationManifestFolderId,
          manifestFilename: adminConfig.manifestFilename
        },
        null,
        2
      );
    }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
//# sourceMappingURL=app.js.map
