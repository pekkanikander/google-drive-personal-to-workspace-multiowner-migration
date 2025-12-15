export type TransferMode = "move";

export type ManifestStatus = "" | "STARTED" | "DONE" | "FAILED";

export interface JobInfo {
  job_id: string;
  job_label: string;
  transfer_mode: TransferMode;
  manifest_version: string;
  dest_drive_id: string;
  dest_root_id: string;
  manifest_sheet_name: string;
  log_sheet_name: string;
  source_root_id: string;
}

export interface JobInfoRow {
  key: keyof JobInfo | string;
  value: string;
}

export interface ManifestRow {
  id: string;
  name: string;
  mimeType: string;
  parents: string;
  owners: string;
  driveId: string;
  trashed: string;
  shortcut_target_id: string;
  shortcut_target_mimeType: string;
  permissions: string;
  createdTime: string;
  modifiedTime: string;
  dest_parent_id: string;
  dest_drive_id: string;
  status: ManifestStatus;
  worker_session_id: string;
  error: string;
}

export interface LogEntry {
  timestamp: string;
  event: string;
  user_email: string;
  row_index: number;
  file_id: string;
  session_id: string;
  details?: string;
}

export interface OAuthConfig {
  clientId: string;
  scope: string;
  prompt?: "consent" | "select_account";
}

export interface RuntimeConfig {
  oauthClientId: string;
  sheetId?: string;
  jobToken?: string;
}
