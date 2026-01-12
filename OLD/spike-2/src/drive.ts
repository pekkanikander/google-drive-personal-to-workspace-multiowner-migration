export interface DriveHttpError {
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson?: unknown;
  reason?: string;
  message?: string;
}

export interface FileMetadataSnapshot {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  driveId?: string;
  ownedByMe?: boolean;
  owners?: Array<{ displayName?: string; emailAddress?: string; me?: boolean }>;
  capabilities?: Record<string, unknown>;
}

export interface MoveRequestInfo {
  fileId: string;
  destinationFolderId: string;
  supportsAllDrives: boolean;
  addParents: string;
  removeParents?: string;
}

export interface MoveDiagnostics {
  request: MoveRequestInfo;
  before: FileMetadataSnapshot;
  after?: FileMetadataSnapshot;
  error?: DriveHttpError;
}

export interface MoveFileResult {
  ok: true;
  result: { id: string; name?: string; webViewLink?: string };
  diagnostics: MoveDiagnostics;
}

export interface MoveFileFailure {
  ok: false;
  diagnostics: MoveDiagnostics;
}

export type MoveFileOutcome = MoveFileResult | MoveFileFailure;

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of headers.entries()) out[k] = v;
  return out;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractDriveReason(bodyJson: unknown): { reason?: string; message?: string } {
  // Drive errors are typically: { error: { errors: [{ reason, message, ... }], message, ... } }
  if (!bodyJson || typeof bodyJson !== "object") return {};
  const anyJson = bodyJson as any;
  const err = anyJson.error;
  if (!err || typeof err !== "object") return {};
  const topMessage = typeof err.message === "string" ? err.message : undefined;
  const errors = Array.isArray(err.errors) ? err.errors : undefined;
  const first = errors && errors.length > 0 ? errors[0] : undefined;
  const reason = first && typeof first.reason === "string" ? first.reason : undefined;
  const message = first && typeof first.message === "string" ? first.message : topMessage;
  return { reason, message };
}

async function fetchJsonWithHttp<T>(url: string, options: RequestInit): Promise<{ ok: true; json: T } | { ok: false; error: DriveHttpError }> {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  const headers = headersToRecord(response.headers);

  if (!response.ok) {
    const bodyJson = tryParseJson(bodyText);
    const { reason, message } = extractDriveReason(bodyJson);
    return {
      ok: false,
      error: {
        status: response.status,
        statusText: response.statusText,
        url,
        headers,
        bodyText,
        bodyJson,
        reason,
        message
      }
    };
  }

  const bodyJson = tryParseJson(bodyText);
  return { ok: true, json: (bodyJson as T) ?? ({} as T) };
}

async function getFileSnapshot(accessToken: string, fileId: string): Promise<FileMetadataSnapshot> {
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
  const res = await fetchJsonWithHttp<FileMetadataSnapshot>(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    // If we cannot read metadata, still return a minimal snapshot to avoid losing context.
    return { id: fileId };
  }

  // Ensure the id is always present.
  return { id: fileId, ...res.json };
}

export async function moveFile(
  accessToken: string,
  fileId: string,
  destinationFolderId: string
): Promise<MoveFileOutcome> {
  const before = await getFileSnapshot(accessToken, fileId);
  const existingParents = before.parents ?? [];

  const params = new URLSearchParams({
    supportsAllDrives: "true",
    addParents: destinationFolderId
  });
  // TODO: removeParents seem to be ignored when moving a file into a Shared Drive.
  // Verify this observation when building the production version, and if so, document it.
  if (existingParents.length > 0) {
    params.set("removeParents", existingParents.join(","));
  }

  const request: MoveRequestInfo = {
    fileId,
    destinationFolderId,
    supportsAllDrives: true,
    addParents: destinationFolderId,
    removeParents: existingParents.length > 0 ? existingParents.join(",") : undefined
  };

  const diagnostics: MoveDiagnostics = {
    request,
    before
  };

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`;
  const patchRes = await fetchJsonWithHttp<{ id: string; name?: string; webViewLink?: string }>(url, {
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
