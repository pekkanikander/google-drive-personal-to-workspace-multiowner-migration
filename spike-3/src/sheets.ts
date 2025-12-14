import { DriveItem } from "./drive";
import { HEADERS, itemsToRows } from "./csv";

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function baseTitle(csvName: string): string {
  return csvName.replace(/\.csv$/i, "") || "spike-3-manifest";
}

async function createEmptySheet(accessToken: string, destinationFolderId: string, title: string): Promise<string> {
  const url = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true";
  const metadata = {
    name: title,
    mimeType: SHEET_MIME,
    parents: [destinationFolderId]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(metadata)
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to create sheet: ${res.status} ${res.statusText}. Body: ${bodyText}`);
  }

  const json = bodyText ? (JSON.parse(bodyText) as { id?: string }) : {};
  if (!json.id) throw new Error("Sheet creation succeeded but missing file id.");
  return json.id;
}

async function writeRows(accessToken: string, spreadsheetId: string, rows: string[][]): Promise<void> {
  // Use default first sheet "Sheet1".
  const range = "Sheet1!A1";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    range
  )}?valueInputOption=RAW`;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: rows })
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to write sheet values: ${res.status} ${res.statusText}. Body: ${bodyText}`);
  }
}

export async function createSheetFromItems(
  accessToken: string,
  destinationFolderId: string,
  suggestedName: string,
  items: DriveItem[]
): Promise<{ spreadsheetId: string; title: string }> {
  const rows = itemsToRows(items);
  // Ensure header row present even if items empty.
  if (rows.length === 0) rows.push([...HEADERS]);

  const title = baseTitle(suggestedName);
  const spreadsheetId = await createEmptySheet(accessToken, destinationFolderId, title);
  await writeRows(accessToken, spreadsheetId, rows);

  return { spreadsheetId, title };
}
