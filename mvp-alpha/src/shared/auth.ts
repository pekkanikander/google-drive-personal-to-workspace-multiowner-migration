import { OAuthConfig } from "./types";

declare const google: any;

export interface TokenResult {
  accessToken: string;
  expiresIn: number;
}

export class TokenClient {
  private client: any;
  private accessToken: string | null = null;
  private expiry: number | null = null;
  private inFlight: Promise<TokenResult> | null = null;

  constructor(config: OAuthConfig) {
    if (!config.clientId) {
      throw new Error("OAuth client ID is required");
    }
    const scope = config.scope || "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email";
    const prompt = config.prompt ?? "select_account";

    // TODO: Simplify the follwoing code.  Now it has a lot of duplicate code.
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope,
      prompt,
      callback: (response: any) => {
        if (response.error) {
          const rejector = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          this.inFlight = null;
          rejector?.(new Error(response.error));
          return;
        }
        const token = response.access_token;
        if (!token) {
          const rejector = this.pendingReject;
          this.pendingResolve = null;
          this.pendingReject = null;
          this.inFlight = null;
          rejector?.(new Error("missing access token"));
          return;
        }
        this.accessToken = token;
        this.expiry = Date.now() + Number(response.expires_in || 0) * 1000;
        const resolver = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        this.inFlight = null;
        resolver?.({
          accessToken: token,
          expiresIn: Number(response.expires_in || 0),
        });
      },
    });
  }

  private pendingResolve: ((value: TokenResult) => void) | null = null;
  private pendingReject: ((reason?: unknown) => void) | null = null;

  async getToken(): Promise<TokenResult> {
    const token = this.accessToken;
    const expiry = this.expiry;
    if (token && expiry && Date.now() < expiry - 30_000) {
      return { accessToken: token, expiresIn: Math.floor((expiry - Date.now()) / 1000) };
    }

    if (!this.inFlight) {
      this.inFlight = new Promise<TokenResult>((resolve, reject) => {
        this.pendingResolve = (value) => {
          this.inFlight = null;
          resolve(value);
        };
        this.pendingReject = (reason) => {
          this.inFlight = null;
          reject(reason);
        };
        this.client.requestAccessToken();
      });
    }

    return this.inFlight;
  }
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const resp = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`userinfo failed: ${resp.status}`);
  }
  const data = await resp.json();
  return data.email;
}
