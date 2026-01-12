import { RuntimeConfig } from "./types";
import { parseJobLink } from "./link";

const SHEET_ID_REGEX = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
const FOLDER_ID_REGEX = /(?:folders|d)\/([a-zA-Z0-9-_]{10,})/;

export function parseSheetIdFromUrl(url: string): string | null {
  const match = url.match(SHEET_ID_REGEX);
  return match ? match[1] : null;
}

export function parseDriveFolderId(urlOrId: string): string | null {
  const trimmed = urlOrId.trim();
  const directId = trimmed.match(/^[a-zA-Z0-9-_]{10,}$/);
  if (directId) return directId[0];
  const match = trimmed.match(FOLDER_ID_REGEX);
  return match ? match[1] : null;
}

export function buildRuntimeConfig(params: { linkFragment?: string }): RuntimeConfig {
  const { sheetId, jobToken, oauthClientId } = params.linkFragment ? parseJobLink(params.linkFragment) : {};
  if (!oauthClientId) throw new Error("oauth client id missing");
  if (!sheetId) throw new Error("sheet id missing");
  if (!jobToken) throw new Error("job token missing");
  return {
    oauthClientId,
    sheetId,
    jobToken,
  };
}
