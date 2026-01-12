"use strict";
(() => {
  // src/config.ts
  var oauthConfig = {
    clientId: "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com",
    redirectUri: "http://localhost:8081/callback.html"
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
    if (!res.ok) {
      return void 0;
    }
    const data = await res.json();
    return data.email;
  }
  async function runPkceAuth() {
    await loadGisScriptOnce();
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: oauthConfig.clientId,
      scope: SCOPES.join(" "),
      // callback is set per-request to avoid race conditions.
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
    return {
      accessToken,
      expiresIn,
      email
    };
  }

  // src/drive.ts
  function headersToRecord(headers) {
    const out = {};
    for (const [k, v] of headers.entries()) out[k] = v;
    return out;
  }
  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return void 0;
    }
  }
  function extractDriveReason(bodyJson) {
    if (!bodyJson || typeof bodyJson !== "object") return {};
    const anyJson = bodyJson;
    const err = anyJson.error;
    if (!err || typeof err !== "object") return {};
    const topMessage = typeof err.message === "string" ? err.message : void 0;
    const errors = Array.isArray(err.errors) ? err.errors : void 0;
    const first = errors && errors.length > 0 ? errors[0] : void 0;
    const reason = first && typeof first.reason === "string" ? first.reason : void 0;
    const message = first && typeof first.message === "string" ? first.message : topMessage;
    return { reason, message };
  }
  async function fetchJsonWithHttp(url, options) {
    const response = await fetch(url, options);
    const bodyText = await response.text();
    const headers = headersToRecord(response.headers);
    if (!response.ok) {
      const bodyJson2 = tryParseJson(bodyText);
      const { reason, message } = extractDriveReason(bodyJson2);
      return {
        ok: false,
        error: {
          status: response.status,
          statusText: response.statusText,
          url,
          headers,
          bodyText,
          bodyJson: bodyJson2,
          reason,
          message
        }
      };
    }
    const bodyJson = tryParseJson(bodyText);
    return { ok: true, json: bodyJson ?? {} };
  }
  async function getFileSnapshot(accessToken, fileId) {
    const fields = [
      "id",
      "name",
      "mimeType",
      "parents",
      "driveId",
      "ownedByMe",
      "owners(displayName,emailAddress,me)",
      "capabilities"
    ].join(",");
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
    const res = await fetchJsonWithHttp(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    if (!res.ok) {
      return { id: fileId };
    }
    return { id: fileId, ...res.json };
  }
  async function moveFile(accessToken, fileId, destinationFolderId) {
    const before = await getFileSnapshot(accessToken, fileId);
    const existingParents = before.parents ?? [];
    const params = new URLSearchParams({
      supportsAllDrives: "true",
      addParents: destinationFolderId
    });
    if (existingParents.length > 0) {
      params.set("removeParents", existingParents.join(","));
    }
    const request = {
      fileId,
      destinationFolderId,
      supportsAllDrives: true,
      addParents: destinationFolderId,
      removeParents: existingParents.length > 0 ? existingParents.join(",") : void 0
    };
    const diagnostics = {
      request,
      before
    };
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`;
    const patchRes = await fetchJsonWithHttp(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
    if (!patchRes.ok) {
      diagnostics.error = patchRes.error;
      return { ok: false, diagnostics };
    }
    const after = await getFileSnapshot(accessToken, fileId);
    diagnostics.after = after;
    return {
      ok: true,
      result: patchRes.json,
      diagnostics
    };
  }

  // src/manifest.ts
  var manifest = {
    sourceFileId: "1mEOEuuRGB7x7N1aU1GAHBmQzke_ww_GyyXpyYKNk4-Q",
    allowedUsers: {
      "nikander.pekka@gmail.com": "10Px9dQKe2WeBl1YGf1BHafs5C4MicfWq"
    }
  };

  // src/app.ts
  function setStatus(message) {
    const statusElement = document.getElementById("status");
    if (statusElement) {
      statusElement.textContent = message;
    }
  }
  function setJsonOutput(label, data) {
    const output = document.getElementById("result");
    if (!output) return;
    const container = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = label;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(data, null, 2);
    container.appendChild(title);
    container.appendChild(pre);
    output.appendChild(container);
  }
  function clearOutput() {
    const output = document.getElementById("result");
    if (output) output.innerHTML = "";
  }
  function summariseOutcome(outcome) {
    const d = outcome.diagnostics;
    const beforeParents = d.before.parents?.length ?? 0;
    const afterParents = d.after?.parents?.length;
    const reason = d.error?.reason;
    const msg = d.error?.message;
    const status = d.error?.status;
    return outcome.ok ? `OK. beforeParents=${beforeParents}, afterParents=${afterParents ?? "?"}` : `FAILED. http=${status ?? "?"}, reason=${reason ?? "?"}, message=${msg ?? "(no message)"}, beforeParents=${beforeParents}`;
  }
  async function handleStart(button) {
    button.disabled = true;
    setStatus("Authorising with Google...");
    try {
      const auth = await runPkceAuth();
      if (!auth.email) {
        throw new Error("Could not determine user email from the ID token.");
      }
      const destinationFolder = manifest.allowedUsers[auth.email];
      if (!destinationFolder) {
        throw new Error(
          `The manifest does not allow ${auth.email}. Update manifest.ts to add this user.`
        );
      }
      clearOutput();
      setStatus("Moving the test file into the Shared Drive...");
      const outcome = await moveFile(auth.accessToken, manifest.sourceFileId, destinationFolder);
      setStatus(summariseOutcome(outcome));
      setJsonOutput("Move diagnostics", outcome.diagnostics);
      if (outcome.ok) {
        const result = outcome.result;
        const output = document.getElementById("result");
        if (output) {
          const details = document.createElement("div");
          details.textContent = `File now at ID: ${result.id}`;
          output.appendChild(details);
          if (result.webViewLink) {
            const anchor = document.createElement("a");
            anchor.href = result.webViewLink;
            anchor.target = "_blank";
            anchor.rel = "noreferrer";
            anchor.textContent = "Open in Drive";
            output.appendChild(anchor);
          }
        }
      } else {
        const err = outcome.diagnostics.error;
        if (err) {
          setJsonOutput("Drive HTTP error (parsed)", {
            status: err.status,
            statusText: err.statusText,
            reason: err.reason,
            message: err.message,
            url: err.url
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Error: ${message}`);
    } finally {
      button.disabled = false;
    }
  }
  function init() {
    const startButton = document.getElementById("start");
    if (!(startButton instanceof HTMLButtonElement)) {
      setStatus("Start button not found in the document.");
      return;
    }
    startButton.addEventListener("click", () => {
      handleStart(startButton);
    });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
//# sourceMappingURL=app.js.map
