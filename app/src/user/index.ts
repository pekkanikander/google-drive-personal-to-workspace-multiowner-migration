import { TokenClient, fetchUserEmail } from "../shared/auth";
import { buildRuntimeConfig } from "../shared/config";
import { DriveClient } from "../shared/drive";
import { Journal } from "../shared/journal";
import { parseJobLink } from "../shared/link";
import { FileListEntry, FileListRow, renderFileTable, setFileStatus } from "../shared/file-list";
import { buildManifestEntries, filterEntriesForOwner, PreparedEntry } from "../shared/manifest";
import { SheetsClient, MANIFEST_HEADERS, buildStatusUpdate, parseJobInfo, parseManifest, serializeLogEntries } from "../shared/sheets";
import { JobInfo, LogEntry, ManifestStatus } from "../shared/types";
import { statusRange } from "./ranges";

declare const __BUILD_TIME__: string;

const MIN_MANIFEST_WRITE_MS = 2000;
type LoadedState = {
  email: string;
  sessionId: string;
  sessionKey: string;
  sheetId: string;
  jobInfo: JobInfo;
  drive: DriveClient;
  sheets: SheetsClient;
  journal: Journal;
  manifestSheetName: string;
  logSheetName: string;
  batchSize: number;
  runnableEntries: PreparedEntry[];
  pendingEntries: PreparedEntry[];
  ignoredCandidates: PreparedEntry[];
  foreignStarted: PreparedEntry[];
  fileRows: Map<number, FileListRow>;
  recoveredStatusUpdates: StatusUpdateIntent[];
  recoveredLogEntries: LogIntent[];
};

type JournalSessionPayload = {
  sessionKey: string;
  sessionId: string;
  createdAt: string;
};

type JournalStatusPayload = {
  sessionKey: string;
  rowIndex: number;
  status: ManifestStatus;
  error?: string;
};

type JournalLogPayload = {
  sessionKey: string;
  rowIndex: number;
  event: string;
};

type StatusUpdateIntent = {
  update: { range: string; values: string[][] };
  rowIndex: number;
  status: ManifestStatus;
  error?: string;
};

type LogIntent = {
  entry: LogEntry;
  rowIndex: number;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setBuildInfo() {
  const buildEl = document.getElementById("build-time");
  if (buildEl) {
    buildEl.textContent = typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "unknown";
  }
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

function setVisible(id: string, visible: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setWarning(id: string, message: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function setListVisible(visible: boolean) {
  const el = document.getElementById("file-list-container");
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function clearFileList() {
  const list = document.getElementById("file-list") as HTMLTableSectionElement | null;
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

function buildSessionKey(sheetId: string, jobToken: string): string {
  return `${sheetId}:${jobToken}`;
}

function sessionEntryId(sessionKey: string): string {
  return `session:${sessionKey}`;
}

function makeIntentId(kind: "status" | "log", sessionKey: string, rowIndex: number): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${kind}:${sessionKey}:${rowIndex}:${Date.now()}:${suffix}`;
}

function isSessionPayload(value: unknown): value is JournalSessionPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionKey === "string" && typeof record.sessionId === "string";
}

function isStatusPayload(value: unknown): value is JournalStatusPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionKey === "string" &&
    typeof record.rowIndex === "number" &&
    typeof record.status === "string"
  );
}

function isLogPayload(value: unknown): value is JournalLogPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionKey === "string" && typeof record.rowIndex === "number" && typeof record.event === "string";
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

function isForeignStarted(entry: PreparedEntry, sessionId: string): boolean {
  if (entry.row.status !== "STARTED") return false;
  return entry.row.worker_session_id !== sessionId;
}

function isRetryableStatus(status: ManifestStatus): boolean {
  return status === "" || status === "FAILED" || status === "STARTED";
}

function displayStatusForEntry(
  entry: PreparedEntry,
  ignoredSet: Set<number>,
  foreignStartedSet: Set<number>,
  ignoreReasonByRow: Map<number, string>,
): string {
  if (ignoredSet.has(entry.rowIndex)) {
    const reason = ignoreReasonByRow.get(entry.rowIndex);
    return reason ? `IGNORED (${reason})` : "IGNORED";
  }
  if (foreignStartedSet.has(entry.rowIndex)) {
    const otherSession = entry.row.worker_session_id || "unknown";
    return `FAILED (started by ${otherSession})`;
  }
  if (entry.row.status === "DONE") return "DONE";
  if (entry.row.status === "FAILED") return "FAILED";
  if (entry.row.status === "IGNORED") return "IGNORED";
  if (entry.row.status === "STARTED") return "STARTED (retry)";
  return "PENDING";
}

function updateEntryStatus(fileRows: Map<number, FileListRow>, entry: PreparedEntry, label: string) {
  const row = fileRows.get(entry.rowIndex);
  if (!row) return;
  setFileStatus(row.statusEl, label);
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

function createStatusIntent(
  sheetName: string,
  entry: PreparedEntry,
  status: ManifestStatus,
  sessionId: string,
  error?: string,
): StatusUpdateIntent {
  return {
    update: makeStatusUpdate(sheetName, entry, status, sessionId, error),
    rowIndex: entry.rowIndex,
    status,
    error,
  };
}

function createLogIntent(
  event: string,
  entry: PreparedEntry,
  userEmail: string,
  sessionId: string,
  details?: string,
): LogIntent {
  return {
    entry: makeLogEntry(event, entry, userEmail, sessionId, details),
    rowIndex: entry.rowIndex,
  };
}

function toFileListEntry(entry: PreparedEntry): FileListEntry {
  return {
    rowIndex: entry.rowIndex,
    name: entry.row.name,
    parents: entry.parents,
    owners: entry.owners,
    status: entry.row.status,
    workerSessionId: entry.row.worker_session_id,
  };
}

async function main() {
  setBuildInfo();
  const status = $("status");
  const btnLoad = $("btn-load") as HTMLButtonElement;
  const btnRun = $("btn-run") as HTMLButtonElement;
  const journal = new Journal();
  const LOAD_LABEL_DEFAULT = "Sign in and load job";
  const LOAD_LABEL_ANOTHER = "Sign in as another user and load job";

  const setLoadButtonLabel = (label: string) => {
    btnLoad.textContent = label;
  };

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
    btnLoad.disabled = true;
    btnRun.disabled = true;
    return;
  }

  let loaded: LoadedState | null = null;

  const resetRunState = () => {
    loaded = null;
    btnRun.disabled = true;
    setVisible("step-run", false);
    setWarning("resume-warning", "");
    setLoadButtonLabel(LOAD_LABEL_DEFAULT);
  };

  resetRunState();

  btnLoad.onclick = async () => {
    let keepDisabled = false;
    btnLoad.disabled = true;
    btnRun.disabled = true;
    setVisible("step-run", false);
    setWarning("resume-warning", "");
    setLoadButtonLabel(LOAD_LABEL_DEFAULT);
    setStatus(status, "Signing in...");
    try {
      if (!(window as any).google) throw new Error("Google Identity Services script not loaded.");
      const tokenClient = new TokenClient({
        clientId: config.oauthClientId,
        scope: "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email",
      });
      const token = await tokenClient.getToken();
      const email = await fetchUserEmail(token.accessToken);
      setStatus(status, `Signed in as ${email}. Loading job...`);

      const sheetId = config.sheetId!;
      const jobToken = config.jobToken!;
      const sessionKey = buildSessionKey(sheetId, jobToken);
      const journalEntries = await journal.getAll();
      const sessionRecord = journalEntries.find((entry) => {
        return entry.id === sessionEntryId(sessionKey) && entry.kind === "session" && isSessionPayload(entry.payload);
      });
      const sessionId = sessionRecord ? (sessionRecord.payload as JournalSessionPayload).sessionId : randomSessionId();
      if (!sessionRecord) {
        await journal.put({
          id: sessionEntryId(sessionKey),
          kind: "session",
          payload: {
            sessionKey,
            sessionId,
            createdAt: new Date().toISOString(),
          } satisfies JournalSessionPayload,
        });
      }
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
      const intentEntries = journalEntries.filter((entry) => {
        if (entry.kind === "status") {
          return isStatusPayload(entry.payload) && entry.payload.sessionKey === sessionKey;
        }
        if (entry.kind === "log") {
          return isLogPayload(entry.payload) && entry.payload.sessionKey === sessionKey;
        }
        return false;
      });
      const intentIds = intentEntries.map((entry) => entry.id);

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
        resetRunState();
        return;
      }

      const drive = new DriveClient(token.accessToken);
      const entryByRowIndex = new Map<number, PreparedEntry>();
      eligible.forEach((entry) => entryByRowIndex.set(entry.rowIndex, entry));
      const pendingRowIndices = new Set<number>();
      intentEntries.forEach((entry) => {
        if (entry.kind === "status" && isStatusPayload(entry.payload)) {
          pendingRowIndices.add(entry.payload.rowIndex);
        } else if (entry.kind === "log" && isLogPayload(entry.payload)) {
          pendingRowIndices.add(entry.payload.rowIndex);
        }
      });
      const recoveredStatusUpdates: StatusUpdateIntent[] = [];
      const recoveredLogEntries: LogIntent[] = [];
      if (pendingRowIndices.size > 0) {
        setStatus(status, `Recovering ${pendingRowIndices.size} pending item(s)...`);
        for (const rowIndex of pendingRowIndices) {
          const entry = entryByRowIndex.get(rowIndex);
          if (!entry) continue;
          if (isMultiParent(entry) || isShortcut(entry)) continue;
          if (entry.row.status === "DONE" || entry.row.status === "IGNORED") continue;
          const fileId = entry.row.id;
          const destParentId = entry.row.dest_parent_id;
          if (!fileId || !destParentId) {
            const message = "missing file id or destination parent";
            entry.row.status = "FAILED";
            entry.row.worker_session_id = sessionId;
            entry.row.error = message;
            recoveredStatusUpdates.push(createStatusIntent(manifestSheetName, entry, "FAILED", sessionId, message));
            recoveredLogEntries.push(createLogIntent("FAIL", entry, email, sessionId, message));
            continue;
          }
          const file = await drive.getFile(fileId);
          const parents = file.parents ?? [];
          if (parents.includes(destParentId)) {
            entry.row.status = "DONE";
            entry.row.worker_session_id = sessionId;
            entry.row.error = "";
            recoveredStatusUpdates.push(createStatusIntent(manifestSheetName, entry, "DONE", sessionId));
            recoveredLogEntries.push(createLogIntent("COMPLETE", entry, email, sessionId, "recovered"));
          }
        }
      }
      if (intentIds.length > 0) {
        await journal.remove(intentIds);
      }
      const ignoredCandidates = eligible.filter((entry) => isMultiParent(entry) || isShortcut(entry));
      const ignoreReasonByRow = new Map<number, string>();
      ignoredCandidates.forEach((entry) => ignoreReasonByRow.set(entry.rowIndex, ignoreReason(entry)));
      const ignoredSet = new Set(ignoredCandidates.map((entry) => entry.rowIndex));
      const foreignStarted = eligible.filter((entry) => isForeignStarted(entry, sessionId));
      const foreignStartedSet = new Set(foreignStarted.map((entry) => entry.rowIndex));
      const runnableEntries = eligible.filter(
        (entry) => !ignoredSet.has(entry.rowIndex) && !foreignStartedSet.has(entry.rowIndex),
      );
      const alreadyDone = runnableEntries.filter((entry) => entry.row.status === "DONE").length;
      const pendingEntries = runnableEntries.filter((entry) => isRetryableStatus(entry.row.status));
      const ignoredCount = ignoredCandidates.length;
      const foreignStartedCount = foreignStarted.length;

      setStats(runnableEntries.length, alreadyDone);
      const statusByRow = new Map<number, string>();
      eligible.forEach((entry) => {
        statusByRow.set(entry.rowIndex, displayStatusForEntry(entry, ignoredSet, foreignStartedSet, ignoreReasonByRow));
      });
      clearFileList();
      setListVisible(eligible.length > 0);
      const list = document.getElementById("file-list") as HTMLTableSectionElement | null;
      const fileRows = list
        ? renderFileTable({
            container: list,
            entries: eligible.map(toFileListEntry),
            drive,
            sourceRootId: jobInfo.source_root_id,
            statusLabelForEntry: (entry) => statusByRow.get(entry.rowIndex) ?? "PENDING",
            setNote: (note) => setText("file-list-note", note),
          })
        : new Map<number, FileListRow>();

      const warningMessage =
        foreignStartedCount > 0
          ? `Some files are marked STARTED by another session. These are skipped and shown as failed. Please contact the admin.`
          : "";
      setWarning("resume-warning", warningMessage);

      setStatus(
        status,
        `Ready.\nJob: ${jobInfo.job_label}\nMode: ${jobInfo.transfer_mode}\nSheet: ${sheetId}\nSigned in as ${email}\nYour files: ${owned.length}\nEligible (single-owner): ${eligible.length}\nSkipped (multi-owner): ${multiOwnerCount}\nIgnored (multi-parent/shortcut): ${ignoredCount}\nBlocked (other session): ${foreignStartedCount}\nBatch size: ${batchSize}\nMoved: ${alreadyDone}`,
        "success",
      );

      loaded = {
        email,
        sessionId,
        sessionKey,
        sheetId,
        jobInfo,
        drive,
        sheets,
        journal,
        manifestSheetName,
        logSheetName,
        batchSize,
        runnableEntries,
        pendingEntries,
        ignoredCandidates,
        foreignStarted,
        fileRows,
        recoveredStatusUpdates,
        recoveredLogEntries,
      };
      btnRun.disabled = false;
      setVisible("step-run", true);
      keepDisabled = true;
    } catch (err: any) {
      setStatus(status, `Error: ${err?.message || err}`, "error");
      resetRunState();
    } finally {
      btnLoad.disabled = keepDisabled;
    }
  };

  btnRun.onclick = async () => {
    if (!loaded) return;
    btnRun.disabled = true;
    btnLoad.disabled = true;
    try {
      const {
        email,
        sessionId,
        sessionKey,
        drive,
        sheets,
        jobInfo,
        journal,
        manifestSheetName,
        logSheetName,
        batchSize,
        runnableEntries,
        pendingEntries,
        ignoredCandidates,
        foreignStarted,
        fileRows,
        recoveredStatusUpdates,
        recoveredLogEntries,
      } = loaded;

      let movedCount = runnableEntries.filter((entry) => entry.row.status === "DONE").length;
      let lastManifestWriteAt = 0;
      let fatalError: string | null = null;

      const ignoreReasonByRow = new Map<number, string>();
      ignoredCandidates.forEach((entry) => ignoreReasonByRow.set(entry.rowIndex, ignoreReason(entry)));
      const ignoredSet = new Set(ignoredCandidates.map((entry) => entry.rowIndex));
      const foreignStartedSet = new Set(foreignStarted.map((entry) => entry.rowIndex));

      let pendingStatusUpdates: StatusUpdateIntent[] = [
        ...recoveredStatusUpdates,
        ...ignoredCandidates
          .filter((entry) => !entry.row.status)
          .map((entry) => {
            const reason = ignoreReasonByRow.get(entry.rowIndex) ?? "";
            updateEntryStatus(fileRows, entry, displayStatusForEntry(entry, ignoredSet, foreignStartedSet, ignoreReasonByRow));
            return createStatusIntent(manifestSheetName, entry, "IGNORED", sessionId, reason);
          }),
      ];
      let pendingLogEntries: LogIntent[] = [
        ...recoveredLogEntries,
        ...ignoredCandidates
          .filter((entry) => !entry.row.status)
          .map((entry) => createLogIntent("IGNORED", entry, email, sessionId, ignoreReason(entry))),
      ];

      const queue = pendingEntries.slice();

      const recordStatusIntents = async (updates: StatusUpdateIntent[]): Promise<string[]> => {
        if (updates.length === 0) return [];
        const ids = updates.map((update) => makeIntentId("status", sessionKey, update.rowIndex));
        try {
          await Promise.all(
            updates.map((update, index) =>
              journal.put({
                id: ids[index],
                kind: "status",
                payload: {
                  sessionKey,
                  rowIndex: update.rowIndex,
                  status: update.status,
                  error: update.error,
                } satisfies JournalStatusPayload,
              }),
            ),
          );
        } catch (err) {
          console.warn("Journal write failed; proceeding without persisted intents.", err);
          return [];
        }
        return ids;
      };

      const recordLogIntents = async (entriesToFlush: LogIntent[]): Promise<string[]> => {
        if (entriesToFlush.length === 0) return [];
        const ids = entriesToFlush.map((entry) => makeIntentId("log", sessionKey, entry.rowIndex));
        try {
          await Promise.all(
            entriesToFlush.map((entry, index) =>
              journal.put({
                id: ids[index],
                kind: "log",
                payload: {
                  sessionKey,
                  rowIndex: entry.rowIndex,
                  event: entry.entry.event,
                } satisfies JournalLogPayload,
              }),
            ),
          );
        } catch (err) {
          console.warn("Journal write failed; proceeding without persisted intents.", err);
          return [];
        }
        return ids;
      };

      const flushStatusUpdates = async (updates: StatusUpdateIntent[]) => {
        if (updates.length === 0) return;
        const elapsed = Date.now() - lastManifestWriteAt;
        if (elapsed < MIN_MANIFEST_WRITE_MS) {
          await delay(MIN_MANIFEST_WRITE_MS - elapsed);
        }
        const journalIds = await recordStatusIntents(updates);
        await sheets.batchUpdate(updates.map((update) => update.update));
        lastManifestWriteAt = Date.now();
        if (journalIds.length > 0) {
          await journal.remove(journalIds);
        }
      };

      const flushLogEntries = async (entriesToFlush: LogIntent[]) => {
        if (entriesToFlush.length === 0) return;
        const journalIds = await recordLogIntents(entriesToFlush);
        await sheets.append(`${logSheetName}!A1`, serializeLogEntries(entriesToFlush.map((entry) => entry.entry)));
        if (journalIds.length > 0) {
          await journal.remove(journalIds);
        }
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
        const claimUpdates = batch.map((entry) => {
          updateEntryStatus(fileRows, entry, "STARTED");
          return createStatusIntent(manifestSheetName, entry, "STARTED", sessionId);
        });
        const claimLogs = batch.map((entry) => createLogIntent("CLAIM", entry, email, sessionId));
        if (pendingStatusUpdates.length === 0 && claimUpdates.length === 0) {
          break;
        }

        await flushStatusUpdates([...pendingStatusUpdates, ...claimUpdates]);
        await flushLogEntries([...pendingLogEntries, ...claimLogs]);
        pendingStatusUpdates = [];
        pendingLogEntries = [];

        if (batch.length === 0) {
          break;
        }

        const batchStatusUpdates: StatusUpdateIntent[] = [];
        const batchLogs: LogIntent[] = [];

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
              updateEntryStatus(fileRows, entry, "DONE");
            } else {
              updateEntryStatus(fileRows, entry, "FAILED");
            }
            const details = result.details ?? result.error;
            const event = result.status === "DONE" ? "COMPLETE" : "FAIL";
            batchStatusUpdates.push(createStatusIntent(manifestSheetName, entry, result.status, sessionId, result.error));
            batchLogs.push(createLogIntent(event, entry, email, sessionId, details));
            if (result.status === "FAILED") {
              fatalError = result.error ?? "Move failed.";
              break;
            }
          } catch (err: any) {
            const message = err?.message || String(err);
            batchStatusUpdates.push(createStatusIntent(manifestSheetName, entry, "FAILED", sessionId, message));
            batchLogs.push(createLogIntent("FAIL", entry, email, sessionId, message));
            updateEntryStatus(fileRows, entry, "FAILED");
            fatalError = message;
            break;
          }
        }

        pendingStatusUpdates = batchStatusUpdates;
        pendingLogEntries = batchLogs;

        if (fatalError) {
          break;
        }
      }

      await flushStatusUpdates(pendingStatusUpdates);
      await flushLogEntries(pendingLogEntries);

      if (fatalError) {
        throw new Error(fatalError);
      }

      setStatus(
        status,
        `Completed.\nJob: ${jobInfo.job_label}\nMoved: ${movedCount} of ${runnableEntries.length}`,
        "success",
      );
      btnRun.disabled = true;
      btnLoad.disabled = false;
      setLoadButtonLabel(LOAD_LABEL_ANOTHER);
    } catch (err: any) {
      setStatus(status, `Error: ${err?.message || err}\nRestart from Step 1.`, "error");
      resetRunState();
    } finally {
      btnLoad.disabled = false;
    }
  };
}

main().catch((err) => {
  console.error(err);
  alert(`Fatal error: ${err?.message || err}`);
});
