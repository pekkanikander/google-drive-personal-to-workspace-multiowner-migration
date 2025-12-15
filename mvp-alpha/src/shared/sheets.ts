import { JobInfo, JobInfoRow, LogEntry, ManifestRow, ManifestStatus } from "./types";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsClient {
  constructor(private readonly accessToken: string, private readonly sheetId: string) {
    if (!accessToken) throw new Error("access token required");
    if (!sheetId) throw new Error("sheet id required");
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const resp = await fetch(`${SHEETS_API}/${this.sheetId}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Sheets API ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async getValues(range: string): Promise<string[][]> {
    const data = await this.request<{ values?: string[][] }>(`/values/${encodeURIComponent(range)}`, { method: "GET" });
    return data.values ?? [];
  }

  async batchUpdate(values: Array<{ range: string; values: string[][] }>): Promise<void> {
    await this.request("/values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        data: values,
        valueInputOption: "RAW",
      }),
    });
  }

  async append(range: string, values: string[][]): Promise<void> {
    await this.request(`/values/${encodeURIComponent(range)}:append`, {
      method: "POST",
      body: JSON.stringify({
        values,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
      }),
    });
  }
}

export function parseJobInfo(rows: string[][]): JobInfo {
  const map: Record<string, string> = {};
  rows.forEach((row) => {
    const [key, value] = row;
    if (key) map[key] = value ?? "";
  });
  const required: Array<keyof JobInfo> = [
    "job_id",
    "job_label",
    "transfer_mode",
    "manifest_version",
    "dest_drive_id",
    "dest_root_id",
    "manifest_sheet_name",
    "log_sheet_name",
    "source_root_id",
  ];
  for (const key of required) {
    if (!map[key]) throw new Error(`JobInfo missing key: ${key}`);
  }
  return map as unknown as JobInfo;
}

export function parseManifest(rows: string[][]): ManifestRow[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  const expected = [
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
    "modifiedTime",
    "dest_parent_id",
    "dest_drive_id",
    "status",
    "worker_session_id",
    "error",
  ];
  if (header.length < expected.length || expected.some((v, i) => header[i] !== v)) {
    throw new Error("Manifest header mismatch");
  }
  const rowsOut: ManifestRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const toObj: Record<string, string> = {};
    expected.forEach((key, idx) => {
      toObj[key] = row[idx] ?? "";
    });
    rowsOut.push(toObj as unknown as ManifestRow);
  }
  return rowsOut;
}

export function serializeJobInfo(info: JobInfo): JobInfoRow[] {
  return Object.entries(info).map(([key, value]) => ({ key, value }));
}

export function buildStatusUpdate(range: string, status: ManifestStatus, workerSessionId: string, error?: string) {
  return {
    range,
    values: [[status, workerSessionId, error ?? ""]],
  };
}

export function serializeLogEntries(entries: LogEntry[]): string[][] {
  return entries.map((e) => [
    e.timestamp,
    e.event,
    e.user_email,
    String(e.row_index),
    e.file_id,
    e.session_id,
    e.details ?? "",
  ]);
}
