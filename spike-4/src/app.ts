import { runBrowserAuth, AuthResponse } from "./auth";
import { appConfig } from "./config";
import { JournalState, loadJournal, saveJournal, StatusUpdateRecord, LogEntryRecord } from "./journal";
import { appendLogs, loadManifestForUser, ManifestRow, SheetLayout, writeStatusUpdates } from "./sheets";

type TaskState = "pending" | "started" | "done";

const sessionId = crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`;

let auth: AuthResponse | null = null;
let layout: SheetLayout | null = null;
let tasks: ManifestRow[] = [];
let multiOwnerSkipped: ManifestRow[] = [];
let queue: JournalState = { statuses: [], logs: [] };
let flushTimer: number | undefined;
let flushing = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setStatus(message: string): void {
  const el = byId<HTMLSpanElement>("status");
  if (el) el.textContent = message;
}

function appendLogLine(message: string): void {
  const el = byId<HTMLPreElement>("log");
  if (!el) return;
  el.textContent += message + "\n";
  el.scrollTop = el.scrollHeight;
}

function setRunning(running: boolean): void {
  ["auth", "start"].forEach((id) => {
    const btn = byId<HTMLButtonElement>(id);
    if (btn) btn.disabled = running;
  });
}

function renderCounts(): void {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status.toUpperCase() === "DONE").length;
  const started = tasks.filter((t) => t.status.toUpperCase() === "STARTED").length;
  const pending = total - done - started;

  const el = byId<HTMLDivElement>("counts");
  if (!el) return;
  el.innerHTML = `
    <div><strong>Total rows (user):</strong> ${total}</div>
    <div><strong>Pending:</strong> ${pending}</div>
    <div><strong>Started:</strong> ${started}</div>
    <div><strong>Done:</strong> ${done}</div>
  `;
}

function renderMultiOwner(): void {
  const el = byId<HTMLPreElement>("multiowner");
  if (!el) return;
  if (multiOwnerSkipped.length === 0) {
    el.textContent = "(none)";
    return;
  }
  const lines = multiOwnerSkipped.map((m) => `${m.rowIndex} :: ${m.id ?? "(no-id)"} :: owners=${m.owners.join(";")}`);
  el.textContent = lines.join("\n");
}

async function persistQueue(): Promise<void> {
  await saveJournal(queue);
}

async function restoreQueue(): Promise<void> {
  queue = await loadJournal();
  if (queue.statuses.length > 0 || queue.logs.length > 0) {
    appendLogLine(`Found pending journal entries: ${queue.statuses.length} status updates, ${queue.logs.length} logs.`);
  }
}

function toStatusUpdate(row: ManifestRow, status: string): StatusUpdateRecord {
  return {
    rowIndex: row.rowIndex,
    status,
    workerSessionId: sessionId
  };
}

function toLogEntry(event: string, row: ManifestRow, details?: string): LogEntryRecord {
  return {
    timestamp: new Date().toISOString(),
    event,
    userEmail: auth?.email ?? "unknown",
    rowIndex: row.rowIndex,
    fileId: row.id,
    sessionId,
    details
  };
}

function localStateFromStatus(status: string): TaskState {
  const upper = status.toUpperCase();
  if (upper === "DONE") return "done";
  if (upper === "STARTED") return "started";
  return "pending";
}

async function enqueueUpdates(statusUpdates: StatusUpdateRecord[], logEntries: LogEntryRecord[]): Promise<void> {
  queue.statuses.push(...statusUpdates);
  queue.logs.push(...logEntries);
  await persistQueue();
}

async function flushQueue(): Promise<void> {
  if (flushing) return;
  if (!auth || !layout) return;
  if (queue.statuses.length === 0 && queue.logs.length === 0) return;

  flushing = true;
  const pendingStatuses = [...queue.statuses];
  const pendingLogs = [...queue.logs];

  try {
    if (pendingStatuses.length > 0) {
      await writeStatusUpdates(auth.accessToken, layout, pendingStatuses);
    }
    if (pendingLogs.length > 0) {
      await appendLogs(auth.accessToken, pendingLogs);
    }
    // Remove flushed entries, keep any new ones that arrived mid-flush.
    queue.statuses.splice(0, pendingStatuses.length);
    queue.logs.splice(0, pendingLogs.length);
    await persistQueue();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`Flush failed: ${msg}`);
    appendLogLine(`Flush failed: ${msg}`);
  } finally {
    flushing = false;
  }
}

function startFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = window.setInterval(() => {
    void flushQueue();
  }, appConfig.flushIntervalMs);
}

function nextClaimable(): ManifestRow[] {
  return tasks.filter((t) => {
    const state = localStateFromStatus(t.status);
    if (state === "done") return false;
    if (state === "pending") {
      if (!t.workerSessionId) return true;
      return t.workerSessionId === sessionId;
    }
    // state === "started"
    return t.workerSessionId === sessionId;
  });
}

async function claimBatch(batch: ManifestRow[]): Promise<void> {
  if (batch.length === 0) return;
  const statusUpdates: StatusUpdateRecord[] = [];
  const logs: LogEntryRecord[] = [];

  for (const row of batch) {
    row.status = "STARTED";
    row.workerSessionId = sessionId;
    statusUpdates.push(toStatusUpdate(row, "STARTED"));
    logs.push(toLogEntry("CLAIM", row));
  }

  await enqueueUpdates(statusUpdates, logs);
  renderCounts();
}

async function completeBatch(batch: ManifestRow[]): Promise<void> {
  if (batch.length === 0) return;
  const statusUpdates: StatusUpdateRecord[] = [];
  const logs: LogEntryRecord[] = [];

  for (const row of batch) {
    row.status = "DONE";
    row.workerSessionId = sessionId;
    statusUpdates.push(toStatusUpdate(row, "DONE"));
    logs.push(toLogEntry("COMPLETE", row));
  }

  await enqueueUpdates(statusUpdates, logs);
  renderCounts();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkLoop(): Promise<void> {
  startFlushTimer();
  await flushQueue();

  while (true) {
    const claimable = nextClaimable().slice(0, appConfig.claimBatchSize);
    if (claimable.length === 0) break;

    await claimBatch(claimable);
    setStatus(`Claimed ${claimable.length} rows; simulating work...`);
    await flushQueue();

    await delay(appConfig.workDelayMs);
    await completeBatch(claimable);
    setStatus(`Completed ${claimable.length} rows.`);
    await flushQueue();
  }

  setStatus("Done. No more rows for this user.");
}

async function handleAuth(): Promise<void> {
  setRunning(true);
  setStatus("Authorising with Google...");
  try {
    auth = await runBrowserAuth();
    setStatus(`Authenticated as ${auth.email ?? "unknown"}. Token expires in ${auth.expiresIn}s.`);
    appendLogLine(`Auth OK. Email: ${auth.email ?? "unknown"}`);
    const sessionEl = byId<HTMLSpanElement>("session");
    if (sessionEl) sessionEl.textContent = sessionId;
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  } finally {
    setRunning(false);
  }
}

async function loadManifest(): Promise<void> {
  if (!auth?.accessToken || !auth.email) {
    throw new Error("Authenticate first; email is required to filter manifest rows.");
  }

  setStatus("Loading manifest from Sheets...");
  const loaded = await loadManifestForUser(auth.accessToken, auth.email);
  layout = loaded.layout;
  tasks = loaded.rows;
  multiOwnerSkipped = loaded.multiOwnerSkipped;
  renderCounts();
  renderMultiOwner();

  if (multiOwnerSkipped.length > 0) {
    appendLogLine(`Skipping ${multiOwnerSkipped.length} multi-owner rows.`);
    const logEntries: LogEntryRecord[] = multiOwnerSkipped.map((row) => toLogEntry("SKIP_MULTI_OWNER", row, row.owners.join(";")));
    await enqueueUpdates([], logEntries);
  }
}

async function handleStart(): Promise<void> {
  if (!auth) {
    await handleAuth();
    if (!auth) return;
  }

  setRunning(true);
  try {
    await restoreQueue();
    await loadManifest();
    await runWorkLoop();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(msg);
    appendLogLine(msg);
  } finally {
    setRunning(false);
  }
}

function init(): void {
  byId<HTMLButtonElement>("auth")?.addEventListener("click", () => void handleAuth());
  byId<HTMLButtonElement>("start")?.addEventListener("click", () => void handleStart());

  const configEl = byId<HTMLPreElement>("config");
  if (configEl) {
    configEl.textContent = JSON.stringify(
      {
        spreadsheetId: appConfig.spreadsheetId,
        statusSheetName: appConfig.statusSheetName,
        logSheetName: appConfig.logSheetName,
        claimBatchSize: appConfig.claimBatchSize,
        workDelayMs: appConfig.workDelayMs,
        flushIntervalMs: appConfig.flushIntervalMs
      },
      null,
      2
    );
  }

  const sessionEl = byId<HTMLSpanElement>("session");
  if (sessionEl) sessionEl.textContent = sessionId;
  renderCounts();
  renderMultiOwner();
}

document.addEventListener("DOMContentLoaded", init);
