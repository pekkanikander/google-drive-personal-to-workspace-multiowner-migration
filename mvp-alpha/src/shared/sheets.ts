import { JobInfo, JobInfoRow, LogEntry, ManifestRow, ManifestStatus } from "./types";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
export const JOB_INFO_KEYS: Array<keyof JobInfo> = [
  "job_id",
  "job_label",
  "transfer_mode",
  "manifest_version",
  "dest_drive_id",
  "dest_root_id",
  "manifest_sheet_name",
  "log_sheet_name",
  "source_root_id",
  // optional: oauth_client_id could be added here if stored
];

export const LOG_HEADERS = ["timestamp", "event", "user_email", "row_index", "file_id", "session_id", "details"] as const;

export const MANIFEST_HEADERS = [
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
] as const;

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

  async getSheets(): Promise<Array<{ sheetId: number; title: string; index: number }>> {
    const data = await this.request<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }> }>(
      "?fields=sheets.properties",
      { method: "GET" },
    );
    return (data.sheets ?? [])
      .map((s) => ({
        sheetId: s.properties?.sheetId ?? -1,
        title: s.properties?.title ?? "",
        index: s.properties?.index ?? 0,
      }))
      .filter((s) => s.sheetId !== -1 && s.title);
  }

  async ensureJobSheets(): Promise<void> {
    const sheets = await this.getSheets();
    const requests: any[] = [];
    const job = sheets.find((s) => s.title === "JobInfo");
    if (job) {
      if (job.index !== 0) {
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: job.sheetId, index: 0 },
            fields: "index",
          },
        });
      }
    } else {
      if (sheets.length > 0) {
        const first = sheets[0];
        requests.push({
          updateSheetProperties: {
            properties: { sheetId: first.sheetId, title: "JobInfo", index: 0 },
            fields: "title,index",
          },
        });
      } else {
        requests.push({ addSheet: { properties: { title: "JobInfo", index: 0 } } });
      }
    }

    const existingTitles = new Set<string>(sheets.map((s) => s.title));
    if (!existingTitles.has("JobInfo")) existingTitles.add("JobInfo");
    ["Manifest", "Log"].forEach((title) => {
      if (!existingTitles.has(title)) {
        requests.push({ addSheet: { properties: { title } } });
      }
    });

    if (requests.length === 0) return;
    await this.request(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests }),
    });
  }
}

export function parseJobInfo(rows: string[][]): JobInfo {
  const map: Record<string, string> = {};
  rows.forEach((row) => {
    const [key, value] = row;
    if (key) map[key] = value ?? "";
  });
  for (const key of JOB_INFO_KEYS) {
    if (!map[key]) throw new Error(`JobInfo missing key: ${key}`);
  }
  return map as unknown as JobInfo;
}

export function parseManifest(rows: string[][]): ManifestRow[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  if (header.length < MANIFEST_HEADERS.length || MANIFEST_HEADERS.some((v, i) => header[i] !== v)) {
    throw new Error("Manifest header mismatch");
  }
  const rowsOut: ManifestRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const toObj: Record<string, string> = {};
    MANIFEST_HEADERS.forEach((key, idx) => {
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
