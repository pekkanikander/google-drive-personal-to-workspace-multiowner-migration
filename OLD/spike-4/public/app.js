"use strict";
(() => {
  // src/config.ts
  var oauthConfig = {
    clientId: "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com"
  };
  var appConfig = {
    spreadsheetId: "1bE37jbEhI6CUD_uiW0Bc25T3G9fk3SxJJg6jvpl8lcw",
    statusSheetName: "Sheet1",
    logSheetName: "Log",
    claimBatchSize: 5,
    workDelayMs: 1500,
    flushIntervalMs: 2e3
  };

  // src/auth.ts
  var GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
  var USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
  var SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/spreadsheets"];
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

  // src/journal.ts
  var DB_NAME = "spike4-journal";
  var STORE_NAME = "pending";
  var KEY = "queue";
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
      req.onsuccess = () => resolve(req.result);
    });
  }
  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB operation failed"));
    });
  }
  async function loadJournal() {
    const existing = await withStore("readonly", (store) => store.get(KEY));
    if (!existing) {
      return { statuses: [], logs: [] };
    }
    return existing;
  }
  async function saveJournal(state) {
    await withStore("readwrite", (store) => store.put(state, KEY));
  }

  // src/sheets.ts
  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }
  function columnToA1(col) {
    let n = col;
    let result = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }
  async function fetchSheetValues(accessToken, sheetName) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(appConfig.spreadsheetId)}/values/${encodeURIComponent(sheetName)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to read sheet ${sheetName}: ${res.status} ${res.statusText}. Body: ${bodyText}`);
    }
    const json = bodyText ? JSON.parse(bodyText) : {};
    return json.values ?? [];
  }
  function parseLayout(values) {
    assert(values.length > 0, "Sheet is empty; expected header row.");
    const header = values[0].map((h) => h.trim().toLowerCase());
    const statusCol = header.indexOf("status") + 1;
    const workerSessionCol = header.indexOf("worker_session_id") + 1;
    const ownersCol = header.indexOf("owners") + 1;
    const idCol = header.indexOf("id") + 1;
    const nameCol = header.indexOf("name") + 1;
    assert(statusCol > 0 && workerSessionCol > 0 && ownersCol > 0 && idCol > 0 && nameCol > 0, "Missing expected columns in header.");
    return {
      headers: values[0],
      statusCol,
      workerSessionCol,
      ownersCol,
      idCol,
      nameCol
    };
  }
  function ownersFromCell(cell) {
    if (!cell) return [];
    return cell.split(";").map((o) => o.trim()).filter((o) => o.length > 0);
  }
  function filterManifestForUser(values, email) {
    const layout2 = parseLayout(values);
    const rows = [];
    const multiOwnerSkipped2 = [];
    const lowerEmail = email.toLowerCase();
    for (let i = 1; i < values.length; i++) {
      const rowValues = values[i] ?? [];
      const owners = ownersFromCell(rowValues[layout2.ownersCol - 1]);
      const matches = owners.map((o) => o.toLowerCase()).includes(lowerEmail);
      if (!matches) continue;
      const status = rowValues[layout2.statusCol - 1] ?? "";
      const workerSessionId = rowValues[layout2.workerSessionCol - 1] ?? "";
      const id = rowValues[layout2.idCol - 1];
      const name = rowValues[layout2.nameCol - 1];
      const isMultiOwner = owners.length > 1;
      const manifestRow = {
        rowIndex: i + 1,
        values: rowValues,
        status,
        workerSessionId,
        owners,
        id,
        name,
        isMultiOwner
      };
      if (isMultiOwner) {
        multiOwnerSkipped2.push(manifestRow);
      } else {
        rows.push(manifestRow);
      }
    }
    return { layout: layout2, rows, multiOwnerSkipped: multiOwnerSkipped2 };
  }
  async function loadManifestForUser(accessToken, email) {
    const values = await fetchSheetValues(accessToken, appConfig.statusSheetName);
    return filterManifestForUser(values, email);
  }
  async function writeStatusUpdates(accessToken, layout2, updates) {
    if (updates.length === 0) return;
    const data = updates.map((u) => {
      const startCol = Math.min(layout2.statusCol, layout2.workerSessionCol);
      const endCol = Math.max(layout2.statusCol, layout2.workerSessionCol);
      const range = `${appConfig.statusSheetName}!${columnToA1(startCol)}${u.rowIndex}:${columnToA1(endCol)}${u.rowIndex}`;
      const values = layout2.statusCol < layout2.workerSessionCol ? [[u.status, u.workerSessionId]] : [[u.workerSessionId, u.status]];
      return { range, values };
    });
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(appConfig.spreadsheetId)}/values:batchUpdate`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data
      })
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to write status updates: ${res.status} ${res.statusText}. Body: ${bodyText}`);
    }
  }
  async function appendLogs(accessToken, entries) {
    if (entries.length === 0) return;
    const values = entries.map((e) => [e.timestamp, e.event, e.userEmail, e.rowIndex, e.fileId ?? "", e.sessionId, e.details ?? ""]);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(appConfig.spreadsheetId)}/values/${encodeURIComponent(
      `${appConfig.logSheetName}!A1`
    )}:append?valueInputOption=RAW`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values })
    });
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`Failed to append logs: ${res.status} ${res.statusText}. Body: ${bodyText}`);
    }
  }

  // src/app.ts
  var sessionId = crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`;
  var auth = null;
  var layout = null;
  var tasks = [];
  var multiOwnerSkipped = [];
  var queue = { statuses: [], logs: [] };
  var flushTimer;
  var flushing = false;
  function byId(id) {
    return document.getElementById(id);
  }
  function setStatus(message) {
    const el = byId("status");
    if (el) el.textContent = message;
  }
  function appendLogLine(message) {
    const el = byId("log");
    if (!el) return;
    el.textContent += message + "\n";
    el.scrollTop = el.scrollHeight;
  }
  function setRunning(running) {
    ["auth", "start"].forEach((id) => {
      const btn = byId(id);
      if (btn) btn.disabled = running;
    });
  }
  function renderCounts() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status.toUpperCase() === "DONE").length;
    const started = tasks.filter((t) => t.status.toUpperCase() === "STARTED").length;
    const pending = total - done - started;
    const el = byId("counts");
    if (!el) return;
    el.innerHTML = `
    <div><strong>Total rows (user):</strong> ${total}</div>
    <div><strong>Pending:</strong> ${pending}</div>
    <div><strong>Started:</strong> ${started}</div>
    <div><strong>Done:</strong> ${done}</div>
  `;
  }
  function renderMultiOwner() {
    const el = byId("multiowner");
    if (!el) return;
    if (multiOwnerSkipped.length === 0) {
      el.textContent = "(none)";
      return;
    }
    const lines = multiOwnerSkipped.map((m) => `${m.rowIndex} :: ${m.id ?? "(no-id)"} :: owners=${m.owners.join(";")}`);
    el.textContent = lines.join("\n");
  }
  async function persistQueue() {
    await saveJournal(queue);
  }
  async function restoreQueue() {
    queue = await loadJournal();
    if (queue.statuses.length > 0 || queue.logs.length > 0) {
      appendLogLine(`Found pending journal entries: ${queue.statuses.length} status updates, ${queue.logs.length} logs.`);
    }
  }
  function toStatusUpdate(row, status) {
    return {
      rowIndex: row.rowIndex,
      status,
      workerSessionId: sessionId
    };
  }
  function toLogEntry(event, row, details) {
    return {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      event,
      userEmail: auth?.email ?? "unknown",
      rowIndex: row.rowIndex,
      fileId: row.id,
      sessionId,
      details
    };
  }
  function localStateFromStatus(status) {
    const upper = status.toUpperCase();
    if (upper === "DONE") return "done";
    if (upper === "STARTED") return "started";
    return "pending";
  }
  async function enqueueUpdates(statusUpdates, logEntries) {
    queue.statuses.push(...statusUpdates);
    queue.logs.push(...logEntries);
    await persistQueue();
  }
  async function flushQueue() {
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
  function startFlushTimer() {
    if (flushTimer) return;
    flushTimer = window.setInterval(() => {
      void flushQueue();
    }, appConfig.flushIntervalMs);
  }
  function nextClaimable() {
    return tasks.filter((t) => {
      const state = localStateFromStatus(t.status);
      if (state === "done") return false;
      if (state === "pending") {
        if (!t.workerSessionId) return true;
        return t.workerSessionId === sessionId;
      }
      return t.workerSessionId === sessionId;
    });
  }
  async function claimBatch(batch) {
    if (batch.length === 0) return;
    const statusUpdates = [];
    const logs = [];
    for (const row of batch) {
      row.status = "STARTED";
      row.workerSessionId = sessionId;
      statusUpdates.push(toStatusUpdate(row, "STARTED"));
      logs.push(toLogEntry("CLAIM", row));
    }
    await enqueueUpdates(statusUpdates, logs);
    renderCounts();
  }
  async function completeBatch(batch) {
    if (batch.length === 0) return;
    const statusUpdates = [];
    const logs = [];
    for (const row of batch) {
      row.status = "DONE";
      row.workerSessionId = sessionId;
      statusUpdates.push(toStatusUpdate(row, "DONE"));
      logs.push(toLogEntry("COMPLETE", row));
    }
    await enqueueUpdates(statusUpdates, logs);
    renderCounts();
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  async function runWorkLoop() {
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
  async function handleAuth() {
    setRunning(true);
    setStatus("Authorising with Google...");
    try {
      auth = await runBrowserAuth();
      setStatus(`Authenticated as ${auth.email ?? "unknown"}. Token expires in ${auth.expiresIn}s.`);
      appendLogLine(`Auth OK. Email: ${auth.email ?? "unknown"}`);
      const sessionEl = byId("session");
      if (sessionEl) sessionEl.textContent = sessionId;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }
  async function loadManifest() {
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
      const logEntries = multiOwnerSkipped.map((row) => toLogEntry("SKIP_MULTI_OWNER", row, row.owners.join(";")));
      await enqueueUpdates([], logEntries);
    }
  }
  async function handleStart() {
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
  function init() {
    byId("auth")?.addEventListener("click", () => void handleAuth());
    byId("start")?.addEventListener("click", () => void handleStart());
    const configEl = byId("config");
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
    const sessionEl = byId("session");
    if (sessionEl) sessionEl.textContent = sessionId;
    renderCounts();
    renderMultiOwner();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
//# sourceMappingURL=app.js.map
