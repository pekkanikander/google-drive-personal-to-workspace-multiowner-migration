import { parseSheetIdFromUrl } from "./config";

export interface UserLinkParams {
  baseUrl: string; // required, e.g. https://example.com/user or http://localhost:8081/user
  sheetId: string;
  jobToken: string;
  oauthClientId: string;
}

/**
 * Build a user link carrying sheetId + jobToken either in the fragment (#) or query (?).
 * Keeping parameters in the fragment avoids referrer leakage.
 */
export function buildUserLink(params: UserLinkParams): string {
  const { baseUrl, sheetId, jobToken, oauthClientId } = params;
  if (!baseUrl) throw new Error("baseUrl is required");
  if (!sheetId) throw new Error("sheetId is required");
  if (!jobToken) throw new Error("jobToken is required");
  if (!oauthClientId) throw new Error("oauthClientId is required");

  const url = new URL(baseUrl);
  const payload = new URLSearchParams({ sheet: sheetId, token: jobToken, clientId: oauthClientId }).toString();
  url.hash = payload;
  url.search = "";
  return url.toString();
}

/**
 * Validate and normalise a sheet ID possibly provided as a full URL.
 */
export function normalizeSheetId(input: string): string {
  const direct = input.trim();
  if (!direct) throw new Error("sheet ID required");
  const fromUrl = parseSheetIdFromUrl(direct);
  if (fromUrl) return fromUrl;
  return direct;
}

/**
 * Parse a sheet/token pair from URL search or fragment.
 */
export function parseJobLink(searchOrHash: string): { sheetId?: string; jobToken?: string; oauthClientId?: string } {
  const params = new URLSearchParams(searchOrHash.replace(/^#/, "").replace(/^\?/, ""));
  return {
    sheetId: params.get("sheet") || undefined,
    jobToken: params.get("token") || undefined,
    oauthClientId: params.get("clientId") || undefined,
  };
}
