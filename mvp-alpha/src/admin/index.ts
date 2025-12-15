import { TokenClient, fetchUserEmail } from "../shared/auth";
import { parseDriveFolderId } from "../shared/config";
import { DriveClient, DriveFile } from "../shared/drive";
import { buildUserLink } from "../shared/link";
import {
  JOB_INFO_KEYS,
  LOG_HEADERS,
  MANIFEST_HEADERS,
  SheetsClient,
  parseJobInfo,
  serializeJobInfo,
} from "../shared/sheets";
import { ManifestRow } from "../shared/types";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function randomId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function joinSemicolon(values?: string[]): string {
  return values?.filter(Boolean).join(";") ?? "";
}

function manifestRowToValues(row: ManifestRow): string[] {
  const record = row as unknown as Record<string, string | undefined>;
  return MANIFEST_HEADERS.map((key) => record[key] ?? "");
}

async function ensureAuth(oauthClientId: string, authStatus: HTMLElement) {
  if (!(window as any).google) throw new Error("Google Identity Services script not loaded yet.");
  const tokenClient = new TokenClient({
    clientId: oauthClientId,
    scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
  });
  const token = await tokenClient.getToken();
  const email = await fetchUserEmail(token.accessToken);
  authStatus.textContent = `Signed in as ${email}`;
  return { accessToken: token.accessToken, email };
}

async function ensureFolder(drive: DriveClient, parentId: string, name: string, destDriveId: string): Promise<string> {
  const siblings = await drive.listChildren(parentId);
  const existing = siblings.find((f) => f.mimeType === FOLDER_MIME && f.name === name);
  if (existing) return existing.id;
  const created = await drive.createFolder(name, parentId, destDriveId);
  return created.id;
}

function makeManifestRow(file: DriveFile, destParentId: string, destDriveId: string): ManifestRow {
  const owners = file.owners?.map((o) => o.emailAddress || "").filter(Boolean) ?? [];
  const parents = file.parents ?? [];
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: joinSemicolon(parents),
    owners: joinSemicolon(owners),
    driveId: file.driveId ?? "",
    trashed: file.trashed ? "true" : "false",
    shortcut_target_id: file.shortcutDetails?.targetId ?? "",
    shortcut_target_mimeType: file.shortcutDetails?.targetMimeType ?? "",
    permissions: "",
    createdTime: file.createdTime ?? "",
    modifiedTime: file.modifiedTime ?? "",
    dest_parent_id: destParentId,
    dest_drive_id: destDriveId,
    status: "",
    worker_session_id: "",
    error: "",
  };
}

async function enumerateAndMirror(opts: {
  drive: DriveClient;
  sourceRootId: string;
  destRootId: string;
  destDriveId: string;
  onStatus: (msg: string) => void;
}): Promise<ManifestRow[]> {
  const { drive, sourceRootId, destRootId, destDriveId, onStatus } = opts;
  const manifest: ManifestRow[] = [];
  const folderMap = new Map<string, string>();
  folderMap.set(sourceRootId, destRootId);
  const stack: Array<{ src: string; dest: string }> = [{ src: sourceRootId, dest: destRootId }];
  while (stack.length) {
    const current = stack.pop()!;
    onStatus(`Enumerating: ${manifest.length} files so far; folders mapped: ${folderMap.size}`);
    const children = await drive.listChildren(current.src);
    for (const child of children) {
      if (child.mimeType === FOLDER_MIME) {
        const destParentId = current.dest;
        const destId = await ensureFolder(drive, destParentId, child.name, destDriveId);
        folderMap.set(child.id, destId);
        stack.push({ src: child.id, dest: destId });
      } else {
        const destParentId = folderMap.get(current.src);
        if (!destParentId) continue;
        manifest.push(makeManifestRow(child, destParentId, destDriveId));
      }
    }
  }
  return manifest;
}

async function main() {
  const oauthInput = $("oauth-client-id") as HTMLInputElement;
  const srcInput = $("source-root") as HTMLInputElement;
  const destInput = $("dest-root") as HTMLInputElement;
  const labelInput = $("job-label") as HTMLInputElement;
  const userBaseInput = $("user-base-url") as HTMLInputElement;
  const authStatus = $("auth-status");
  const result = $("result");
  const btnAuth = $("btn-auth") as HTMLButtonElement;
  const btnCreate = $("btn-create") as HTMLButtonElement;

  let cachedToken: { accessToken: string; email: string } | null = null;

  btnAuth.onclick = async () => {
    authStatus.textContent = "Signing in...";
    result.textContent = "";
    try {
      cachedToken = await ensureAuth(oauthInput.value.trim(), authStatus);
    } catch (err: any) {
      authStatus.textContent = `Auth error: ${err?.message || err}`;
      cachedToken = null;
    }
  };

  btnCreate.onclick = async () => {
    result.textContent = "Working...";
    try {
      const oauthClientId = oauthInput.value.trim();
      if (!oauthClientId) throw new Error("OAuth client ID required");
      if (!cachedToken) {
        cachedToken = await ensureAuth(oauthClientId, authStatus);
      }
      const accessToken = cachedToken!.accessToken;
      const drive = new DriveClient(accessToken);

      const sourceId = parseDriveFolderId(srcInput.value.trim());
      if (!sourceId) throw new Error("Source folder ID/URL invalid");
      const destId = parseDriveFolderId(destInput.value.trim());
      if (!destId) throw new Error("Destination folder ID/URL invalid");

      const destMeta = await drive.getFile(destId);
      const destDriveId = destMeta.driveId;
      if (!destDriveId) throw new Error("Destination must be in a Shared Drive (driveId missing).");

      const jobId = randomId("job_");
      const jobToken = randomId("token_");
      const jobLabel = labelInput.value.trim() || "Migration job";

      const dateStr = new Date().toISOString().slice(0, 10);
      const jobFolderName = `File-Migration-${dateStr}`;
      result.textContent = "Preparing job folder...";
      const jobFolderId = await ensureFolder(drive, destId, jobFolderName, destDriveId);

      const sheetName = `${jobLabel} manifest`;
      result.textContent = "Creating spreadsheet...";
      const sheetFile = await drive.createSpreadsheet(sheetName, jobFolderId, destDriveId);
      const sheetId = sheetFile.id;

      const sheets = new SheetsClient(accessToken, sheetId);
      await sheets.ensureJobSheets();

      result.textContent = "Enumerating source and mirroring folders...";
      const manifestRows = await enumerateAndMirror({
        drive,
        sourceRootId: sourceId,
        destRootId: destId,
        destDriveId,
        onStatus: (msg) => (result.textContent = msg),
      });

      const jobInfo = {
        job_id: jobId,
        job_label: jobLabel,
        transfer_mode: "move" as const,
        manifest_version: "v1",
        dest_drive_id: destDriveId,
        dest_root_id: destId,
        manifest_sheet_name: "Manifest",
        log_sheet_name: "Log",
        source_root_id: sourceId,
      };
      const jobPairs = serializeJobInfo(jobInfo);
      jobPairs.push({ key: "job_token", value: jobToken });
      jobPairs.push({ key: "oauth_client_id", value: oauthClientId });

      const jobInfoRange = `JobInfo!A1:B${jobPairs.length}`;
      const manifestValues = [Array.from(MANIFEST_HEADERS), ...manifestRows.map(manifestRowToValues)];
      const manifestRange = `Manifest!A1:Q${manifestValues.length}`;
      const logRange = "Log!A1:G1";

      result.textContent = "Writing sheets...";
      await sheets.batchUpdate([
        { range: jobInfoRange, values: jobPairs.map((p) => [p.key, p.value]) },
        { range: manifestRange, values: manifestValues },
        { range: logRange, values: [Array.from(LOG_HEADERS)] },
      ]);

      const userLink = buildUserLink({
        baseUrl: userBaseInput.value.trim(),
        sheetId,
        jobToken,
        oauthClientId,
      });

      result.innerHTML = `
        <div class="success">Done.</div>
        <div>Sheet ID: <code>${sheetId}</code></div>
        <div>Job ID: <code>${jobId}</code></div>
        <div>Rows in manifest: ${manifestRows.length}</div>
        <div>User link:</div>
        <textarea rows="3">${userLink}</textarea>
      `;
    } catch (err: any) {
      result.innerHTML = `<span class="error">Error: ${err?.message || err}</span>`;
    }
  };
}

main().catch((err) => {
  console.error(err);
  alert(`Fatal error: ${err?.message || err}`);
});
