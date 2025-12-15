import { appConfig } from "./config";

export interface SheetLayout {
  headers: string[];
  statusCol: number;
  workerSessionCol: number;
  ownersCol: number;
  idCol: number;
  nameCol: number;
}

export interface ManifestRow {
  rowIndex: number; // 1-based
  values: string[];
  status: string;
  workerSessionId: string;
  owners: string[];
  id?: string;
  name?: string;
  isMultiOwner: boolean;
}

export interface StatusUpdate {
  rowIndex: number;
  status: string;
  workerSessionId: string;
}

export interface LogEntry {
  timestamp: string;
  event: string;
  userEmail: string;
  rowIndex: number | string;
  fileId?: string;
  sessionId: string;
  details?: string;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function columnToA1(col: number): string {
  let n = col;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

async function fetchSheetValues(accessToken: string, sheetName: string): Promise<string[][]> {
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
  const json = bodyText ? (JSON.parse(bodyText) as { values?: string[][] }) : {};
  return json.values ?? [];
}

function parseLayout(values: string[][]): SheetLayout {
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

function ownersFromCell(cell: string | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(";")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

export function filterManifestForUser(values: string[][], email: string): { layout: SheetLayout; rows: ManifestRow[]; multiOwnerSkipped: ManifestRow[] } {
  const layout = parseLayout(values);
  const rows: ManifestRow[] = [];
  const multiOwnerSkipped: ManifestRow[] = [];
  const lowerEmail = email.toLowerCase();

  for (let i = 1; i < values.length; i++) {
    const rowValues = values[i] ?? [];
    const owners = ownersFromCell(rowValues[layout.ownersCol - 1]);
    const matches = owners.map((o) => o.toLowerCase()).includes(lowerEmail);
    if (!matches) continue;

    const status = rowValues[layout.statusCol - 1] ?? "";
    const workerSessionId = rowValues[layout.workerSessionCol - 1] ?? "";
    const id = rowValues[layout.idCol - 1];
    const name = rowValues[layout.nameCol - 1];
    const isMultiOwner = owners.length > 1;

    const manifestRow: ManifestRow = {
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
      multiOwnerSkipped.push(manifestRow);
    } else {
      rows.push(manifestRow);
    }
  }

  return { layout, rows, multiOwnerSkipped };
}

export async function loadManifestForUser(accessToken: string, email: string): Promise<{ layout: SheetLayout; rows: ManifestRow[]; multiOwnerSkipped: ManifestRow[] }> {
  const values = await fetchSheetValues(accessToken, appConfig.statusSheetName);
  return filterManifestForUser(values, email);
}

export async function writeStatusUpdates(accessToken: string, layout: SheetLayout, updates: StatusUpdate[]): Promise<void> {
  if (updates.length === 0) return;

  const data = updates.map((u) => {
    const startCol = Math.min(layout.statusCol, layout.workerSessionCol);
    const endCol = Math.max(layout.statusCol, layout.workerSessionCol);
    const range = `${appConfig.statusSheetName}!${columnToA1(startCol)}${u.rowIndex}:${columnToA1(endCol)}${u.rowIndex}`;
    const values: string[][] =
      layout.statusCol < layout.workerSessionCol ? [[u.status, u.workerSessionId]] : [[u.workerSessionId, u.status]];
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

export async function appendLogs(accessToken: string, entries: LogEntry[]): Promise<void> {
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
