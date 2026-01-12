export interface OAuthConfig {
  clientId: string;
}

export interface AppConfig {
  spreadsheetId: string;
  statusSheetName: string;
  logSheetName: string;
  claimBatchSize: number;
  workDelayMs: number;
  flushIntervalMs: number;
}

export const oauthConfig: OAuthConfig = {
  clientId: "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com"
};

export const appConfig: AppConfig = {
  spreadsheetId: "1bE37jbEhI6CUD_uiW0Bc25T3G9fk3SxJJg6jvpl8lcw",
  statusSheetName: "Sheet1",
  logSheetName: "Log",
  claimBatchSize: 5,
  workDelayMs: 1500,
  flushIntervalMs: 2000
};
