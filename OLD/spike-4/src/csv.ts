import { DriveItem } from "./drive";

export const HEADERS = [
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

export function itemsToRows(items: DriveItem[]): string[][] {
  const rows: string[][] = [];
  rows.push([...HEADERS]);

  for (const item of items) {
    rows.push([
      item.id ?? "",
      item.name ?? "",
      item.mimeType ?? "",
      formatParents(item),
      formatOwners(item),
      item.driveId ?? "",
      item.trashed ? "true" : "false",
      item.shortcutDetails?.targetId ?? "",
      item.shortcutDetails?.targetMimeType ?? "",
      formatPermissions(item),
      item.createdTime ?? "",
      item.modifiedTime ?? ""
    ]);
  }

  return rows;
}

export function renderCsv(items: DriveItem[]): string {
  const lines: string[] = [];
  const rows = itemsToRows(items);
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(v)).join(","));
  }
  return lines.join("\n");
}
