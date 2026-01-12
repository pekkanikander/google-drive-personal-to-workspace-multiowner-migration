import { TokenClient, fetchUserEmail } from "../shared/auth";
import { buildRuntimeConfig } from "../shared/config";
import { DriveClient } from "../shared/drive";
import { parseJobLink } from "../shared/link";
import { SheetsClient, MANIFEST_HEADERS, buildStatusUpdate, parseJobInfo, parseManifest, serializeLogEntries } from "../shared/sheets";
import { LogEntry, ManifestStatus } from "../shared/types";
import { buildManifestEntries, filterEntriesForOwner, PreparedEntry } from "./manifest";
import { createRelativePathResolver } from "./paths";
import { statusRange } from "./ranges";

const MIN_MANIFEST_WRITE_MS = 2000;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setStatus(el: HTMLElement, msg: string, type: "info" | "error" | "success" = "info") {
  el.textContent = msg;
  el.classList.remove("error", "success");
  if (type === "error") el.classList.add("error");
  if (type === "success") el.classList.add("success");
}

function setText(id: string, value: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setListVisible(visible: boolean) {
  const el = document.getElementById("file-list-container");
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function clearFileList() {
  const list = document.getElementById("file-list") as HTMLOListElement | null;
  if (list) list.innerHTML = "";
  setText("file-list-note", "");
}

function setStats(total: number, moved: number) {
  setText("stat-total", String(total));
  setText("stat-moved", String(moved));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBatchSize(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

function randomSessionId(): string {
  return `session_${Math.random().toString(36).slice(2, 10)}`;
}

function isShortcut(entry: PreparedEntry): boolean {
  return Boolean(entry.row.shortcut_target_id || entry.row.shortcut_target_mimeType);
}

function isMultiParent(entry: PreparedEntry): boolean {
  return entry.parents.length > 1;
}

function ignoreReason(entry: PreparedEntry): string {
  const reasons: string[] = [];
  if (isMultiParent(entry)) reasons.push("multi-parent");
  if (isShortcut(entry)) reasons.push("shortcut");
  return reasons.join("; ");
}

function makeStatusUpdate(
  sheetName: string,
  entry: PreparedEntry,
  status: ManifestStatus,
  sessionId: string,
  error?: string,
) {
  return buildStatusUpdate(statusRange(sheetName, entry.rowIndex), status, sessionId, error);
}

function makeLogEntry(
  event: string,
  entry: PreparedEntry,
  userEmail: string,
  sessionId: string,
  details?: string,
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    event,
    user_email: userEmail,
    row_index: entry.rowIndex,
    file_id: entry.row.id,
    session_id: sessionId,
    details,
  };
}

function renderFileList(entries: PreparedEntry[], drive: DriveClient, sourceRootId: string) {
  clearFileList();
  if (entries.length === 0) {
    setListVisible(false);
    return;
  }
  setListVisible(true);
  const list = document.getElementById("file-list") as HTMLOListElement | null;
  if (!list) return;

  const maxItems = 200;
  const shown = entries.slice(0, maxItems);
  const countNote =
    entries.length > maxItems
      ? `Showing first ${maxItems} of ${entries.length} files.`
      : `Showing ${entries.length} files.`;
  const note = `Paths shown relative to the source root. ${countNote}`;
  setText("file-list-note", note);

  const resolver = createRelativePathResolver(drive, sourceRootId);
  shown.forEach((entry) => {
    const parentId = entry.parents[0] ?? "";
    const li = document.createElement("li");
    li.textContent = entry.row.name;
    list.appendChild(li);
    void resolver
      .resolveFilePath(parentId, entry.row.name)
      .then((path) => {
        li.textContent = path;
      })
      .catch(() => {
        li.textContent = entry.row.name;
      });
  });
}

async function main() {
  const status = $("status");
  const btn = $("btn-start") as HTMLButtonElement;

  let config;
  try {
    const parsed = parseJobLink(window.location.hash);
    config = buildRuntimeConfig({ linkFragment: window.location.hash });
    if (!parsed.sheetId || !parsed.jobToken || !parsed.oauthClientId) {
      throw new Error("Link missing required parameters (sheet/token/clientId).");
    }
    setStatus(status, `Link OK. Sheet: ${parsed.sheetId}`);
  } catch (err: any) {
    setStatus(status, `Invalid or missing link parameters: ${err?.message || err}`, "error");
    btn.disabled = true;
    return;
  }

  btn.onclick = async () => {
    btn.disabled = true;
    setStatus(status, "Signing in...");
    try {
      if (!(window as any).google) throw new Error("Google Identity Services script not loaded.");
      const tokenClient = new TokenClient({
        clientId: config.oauthClientId,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
      });
      const token = await tokenClient.getToken();
      const email = await fetchUserEmail(token.accessToken);
      setStatus(status, `Signed in as ${email}. Validating job...`);

      const sheetId = config.sheetId!;
      const jobToken = config.jobToken!;
      const sheets = new SheetsClient(token.accessToken, sheetId);
      const jobRows = await sheets.getValues("JobInfo!A1:B50");
      const tokenRow = jobRows.find((r) => r[0] === "job_token");
      if (!tokenRow || tokenRow[1] !== jobToken) {
        throw new Error("Job token mismatch or missing in JobInfo sheet.");
      }
      const jobInfo = parseJobInfo(jobRows);
      const manifestSheetName = jobInfo.manifest_sheet_name || "Manifest";
      const logSheetName = jobInfo.log_sheet_name || "Log";
      const batchSize = parseBatchSize(jobInfo.batch_size);
      const sessionId = randomSessionId();

      const manifestHeader = await sheets.getValues(`${manifestSheetName}!1:1`);
      const header = manifestHeader[0] ?? [];
      const headerMismatch =
        header.length < MANIFEST_HEADERS.length || MANIFEST_HEADERS.some((v, i) => header[i] !== v);
      if (headerMismatch) {
        throw new Error("Manifest header mismatch. Please ask admin to regenerate the manifest.");
      }

      const manifestValues = await sheets.getValues(manifestSheetName);
      const manifestRows = parseManifest(manifestValues);
      const entries = buildManifestEntries(manifestRows);
      const { owned, eligible, multiOwnerCount } = filterEntriesForOwner(entries, email);

      if (owned.length === 0) {
        setStats(0, 0);
        setListVisible(false);
        setStatus(
          status,
          `Signed in as ${email}.\nNo files in this manifest are owned by you, so you are not needed for this job.`,
          "success",
        );
        return;
      }

      const drive = new DriveClient(token.accessToken);
      const ignoredCandidates = eligible.filter((entry) => isMultiParent(entry) || isShortcut(entry));
      const ignoredSet = new Set(ignoredCandidates);
      const runnableEntries = eligible.filter((entry) => !ignoredSet.has(entry));
      const alreadyDone = runnableEntries.filter((entry) => entry.row.status === "DONE").length;
      const pendingEntries = runnableEntries.filter((entry) => entry.row.status === "");
      const ignoredCount = ignoredCandidates.length;

      setStats(runnableEntries.length, alreadyDone);
      renderFileList(runnableEntries, drive, jobInfo.source_root_id);

      setStatus(
        status,
        `Ready.\nJob: ${jobInfo.job_label}\nMode: ${jobInfo.transfer_mode}\nSheet: ${sheetId}\nSigned in as ${email}\nYour files: ${owned.length}\nEligible (single-owner): ${eligible.length}\nSkipped (multi-owner): ${multiOwnerCount}\nIgnored (multi-parent/shortcut): ${ignoredCount}\nBatch size: ${batchSize}\nMoved: ${alreadyDone}`,
        "success",
      );

      let movedCount = alreadyDone;
      let lastManifestWriteAt = 0;
      let pendingStatusUpdates = ignoredCandidates
        .filter((entry) => !entry.row.status)
        .map((entry) => {
          const reason = ignoreReason(entry);
          return makeStatusUpdate(manifestSheetName, entry, "IGNORED", sessionId, reason);
        });
      let pendingLogEntries: LogEntry[] = ignoredCandidates
        .filter((entry) => !entry.row.status)
        .map((entry) => makeLogEntry("IGNORED", entry, email, sessionId, ignoreReason(entry)));

      const queue = pendingEntries.slice();

      const flushStatusUpdates = async (updates: Array<{ range: string; values: string[][] }>) => {
        if (updates.length === 0) return;
        const elapsed = Date.now() - lastManifestWriteAt;
        if (elapsed < MIN_MANIFEST_WRITE_MS) {
          await delay(MIN_MANIFEST_WRITE_MS - elapsed);
        }
        await sheets.batchUpdate(updates);
        lastManifestWriteAt = Date.now();
      };

      const flushLogEntries = async (entriesToFlush: LogEntry[]) => {
        if (entriesToFlush.length === 0) return;
        await sheets.append(`${logSheetName}!A1`, serializeLogEntries(entriesToFlush));
      };

      const processEntry = async (entry: PreparedEntry) => {
        const fileId = entry.row.id;
        const destParentId = entry.row.dest_parent_id;
        if (!fileId || !destParentId) {
          return { status: "FAILED" as ManifestStatus, error: "missing file id or destination parent" };
        }
        const file = await drive.getFile(fileId);
        const parents = file.parents ?? [];
        if (parents.includes(destParentId)) {
          return { status: "DONE" as ManifestStatus, details: "already in destination" };
        }
        if (parents.length === 0) {
          return { status: "FAILED" as ManifestStatus, error: "file has no parents" };
        }
        await drive.moveFile(fileId, destParentId, parents);
        return { status: "DONE" as ManifestStatus };
      };

      while (true) {
        const batch = queue.splice(0, batchSize);
        const claimUpdates = batch.map((entry) => makeStatusUpdate(manifestSheetName, entry, "STARTED", sessionId));
        if (pendingStatusUpdates.length === 0 && claimUpdates.length === 0) {
          break;
        }

        await flushStatusUpdates([...pendingStatusUpdates, ...claimUpdates]);
        await flushLogEntries(pendingLogEntries);
        pendingStatusUpdates = [];
        pendingLogEntries = [];

        if (batch.length === 0) {
          break;
        }

        const batchStatusUpdates: Array<{ range: string; values: string[][] }> = [];
        const batchLogs: LogEntry[] = [];

        for (const entry of batch) {
          setStatus(
            status,
            `Moving ${movedCount + 1} of ${runnableEntries.length}...\n${entry.row.name}`,
          );
          try {
            const result = await processEntry(entry);
            if (result.status === "DONE") {
              movedCount += 1;
              setStats(runnableEntries.length, movedCount);
            }
            const details = result.details ?? result.error;
            const event = result.status === "DONE" ? "COMPLETE" : "FAIL";
            batchStatusUpdates.push(
              makeStatusUpdate(manifestSheetName, entry, result.status, sessionId, result.error),
            );
            batchLogs.push(makeLogEntry(event, entry, email, sessionId, details));
          } catch (err: any) {
            const message = err?.message || String(err);
            batchStatusUpdates.push(makeStatusUpdate(manifestSheetName, entry, "FAILED", sessionId, message));
            batchLogs.push(makeLogEntry("FAIL", entry, email, sessionId, message));
            setStatus(status, `Error: ${message}`, "error");
          }
        }

        pendingStatusUpdates = batchStatusUpdates;
        pendingLogEntries = batchLogs;
      }

      await flushStatusUpdates(pendingStatusUpdates);
      await flushLogEntries(pendingLogEntries);

      setStatus(
        status,
        `Completed.\nJob: ${jobInfo.job_label}\nMoved: ${movedCount} of ${runnableEntries.length}`,
        "success",
      );
    } catch (err: any) {
      setStatus(status, `Error: ${err?.message || err}`, "error");
      btn.disabled = false;
    }
  };
}

main().catch((err) => {
  console.error(err);
  alert(`Fatal error: ${err?.message || err}`);
});
