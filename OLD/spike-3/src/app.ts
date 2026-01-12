import { runBrowserAuth, AuthResponse } from "./auth";
import { adminConfig } from "./config";
import { DriveItem, enumerateTree, uploadCsvToDrive } from "./drive";
import { renderCsv } from "./csv";
import { createSheetFromItems } from "./sheets";

let auth: AuthResponse | null = null;
let items: DriveItem[] = [];

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(message: string): void {
  const el = byId<HTMLSpanElement>("status");
  if (el) el.textContent = message;
}

function appendLog(message: string): void {
  const el = byId<HTMLPreElement>("log");
  if (!el) return;
  el.textContent += message + "\n";
  el.scrollTop = el.scrollHeight;
}

function setRunning(running: boolean): void {
  const buttons = [
    "auth",
    "enumerate",
    "download",
    "upload",
    "sheet"
  ]
    .map((id) => byId<HTMLButtonElement>(id))
    .filter((b): b is HTMLButtonElement => !!b);
  buttons.forEach((b) => (b.disabled = running));
}

function summarise(items: DriveItem[]): { folders: number; files: number; shortcuts: number; multiParent: DriveItem[] } {
  let folders = 0;
  let files = 0;
  let shortcuts = 0;
  const multiParent: DriveItem[] = [];

  for (const item of items) {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      folders += 1;
    } else if (item.shortcutDetails) {
      shortcuts += 1;
      files += 1; // still include in total
    } else {
      files += 1;
    }

    if ((item.parents?.length ?? 0) > 1) {
      multiParent.push(item);
    }
  }

  return { folders, files, shortcuts, multiParent };
}

function showSummary(items: DriveItem[]): void {
  const summary = summarise(items);
  const el = byId<HTMLDivElement>("summary");
  if (!el) return;

  el.innerHTML = `
    <div><strong>Total items:</strong> ${items.length}</div>
    <div><strong>Folders:</strong> ${summary.folders}</div>
    <div><strong>Files (incl. shortcuts):</strong> ${summary.files}</div>
    <div><strong>Shortcuts:</strong> ${summary.shortcuts}</div>
    <div><strong>Multi-parent items:</strong> ${summary.multiParent.length}</div>
  `;

  const multi = byId<HTMLPreElement>("multiparent");
  if (multi) {
    if (summary.multiParent.length === 0) {
      multi.textContent = "(none)";
    } else {
      const lines = summary.multiParent.map((m) => `${m.id} :: ${m.name ?? "(unnamed)"} :: parents=${(m.parents ?? []).join(";")}`);
      multi.textContent = lines.join("\n");
    }
  }
}

function ensureAuth(): asserts auth is AuthResponse {
  if (!auth) {
    throw new Error("Authenticate first.");
  }
}

async function handleAuth(): Promise<void> {
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

async function handleEnumerate(): Promise<void> {
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

    items = await enumerateTree(auth.accessToken, root, ({ folderId, items, page }) => {
      appendLog(`Folder ${folderId}: page ${page}, ${items} items`);
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

function handleDownload(): void {
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

async function handleUpload(): Promise<void> {
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

async function handleSheet(): Promise<void> {
  setRunning(true);
  try {
    ensureAuth();
    if (items.length === 0) throw new Error("Nothing to write. Run enumeration first.");
    const dest = adminConfig.destinationManifestFolderId;
    if (!dest || dest.startsWith("REPLACE_WITH")) {
      throw new Error("Configure destinationManifestFolderId first.");
    }

    const title = (adminConfig.manifestFilename || "spike-3-manifest").replace(/\.csv$/i, "");

    setStatus("Creating Google Sheet...");
    const { spreadsheetId } = await createSheetFromItems(auth.accessToken, dest, title, items);
    setStatus(`Sheet created. Spreadsheet ID: ${spreadsheetId}`);
    appendLog(`Sheet created. Spreadsheet ID: ${spreadsheetId}`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    appendLog("Sheet creation failed.");
  } finally {
    setRunning(false);
  }
}

function init(): void {
  byId<HTMLButtonElement>("auth")?.addEventListener("click", () => void handleAuth());
  byId<HTMLButtonElement>("enumerate")?.addEventListener("click", () => void handleEnumerate());
  byId<HTMLButtonElement>("download")?.addEventListener("click", () => handleDownload());
  byId<HTMLButtonElement>("upload")?.addEventListener("click", () => void handleUpload());
  byId<HTMLButtonElement>("sheet")?.addEventListener("click", () => void handleSheet());

  const cfg = byId<HTMLPreElement>("config");
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
