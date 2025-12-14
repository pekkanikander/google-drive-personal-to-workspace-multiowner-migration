import { DriveItem } from "./drive";

const HEADERS = [
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
  "modifiedTime"
] as const;

function csvEscape(value: string): string {
  const needsQuotes = value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r");
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function formatOwners(item: DriveItem): string {
  return (item.owners ?? [])
    .map((o) => o.emailAddress)
    .filter((e): e is string => !!e)
    .join(";");
}

function formatParents(item: DriveItem): string {
  return (item.parents ?? []).join(";");
}

function formatPermissions(item: DriveItem): string {
  const perms = (item.permissions ?? []).map((p) => ({
    type: p.type,
    role: p.role,
    emailAddress: p.emailAddress
  }));
  return perms.length > 0 ? JSON.stringify(perms) : "";
}

export function renderCsv(items: DriveItem[]): string {
  const lines: string[] = [];
  lines.push(HEADERS.join(","));

  for (const item of items) {
    const row: string[] = [];
    row.push(item.id ?? "");
    row.push(item.name ?? "");
    row.push(item.mimeType ?? "");
    row.push(formatParents(item));
    row.push(formatOwners(item));
    row.push(item.driveId ?? "");
    row.push(item.trashed ? "true" : "false");
    row.push(item.shortcutDetails?.targetId ?? "");
    row.push(item.shortcutDetails?.targetMimeType ?? "");
    row.push(formatPermissions(item));
    row.push(item.createdTime ?? "");
    row.push(item.modifiedTime ?? "");

    lines.push(row.map((v) => csvEscape(v)).join(","));
  }

  return lines.join("\n");
}
