import { oauthConfig } from "./config";

// Secretless browser auth for the spike: use Google Identity Services (GIS)
// token client to obtain an access token directly, then call OIDC userinfo
// to obtain the user's email.
//
// This keeps the spike as a pure static SPA (no embedded client secret).

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive"
];

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  email?: string;
}

type GisTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

declare global {
  interface Window {
    google?: any;
  }
}

function loadGisScriptOnce(): Promise<void> {
  // Already loaded?
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  // Already in-flight?
  const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services script.")), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  });
}

async function fetchUserEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch(USERINFO_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    // Email is helpful but not strictly required for the spike to call Drive.
    return undefined;
  }

  const data = (await res.json()) as { email?: string };
  return data.email;
}

/**
 * Kept name for compatibility with the rest of the spike.
 *
 * Note: This is no longer an auth-code+PKCE exchange. It is a GIS token client flow
 * (public client, no secret). Long runs may require re-authentication when the
 * access token expires.
 */
export async function runPkceAuth(): Promise<AuthResponse> {
  await loadGisScriptOnce();

  const tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: oauthConfig.clientId,
    scope: SCOPES.join(" "),
    // callback is set per-request to avoid race conditions.
    callback: () => {
      // no-op
    }
  });

  const token = await new Promise<GisTokenResponse>((resolve) => {
    tokenClient.callback = (resp: GisTokenResponse) => resolve(resp);
    // Force a consent prompt so we consistently get the scopes in early testing.
    tokenClient.requestAccessToken({ prompt: "consent" });
  });

  if (token.error) {
    const desc = token.error_description ? `: ${token.error_description}` : "";
    throw new Error(`OAuth token request failed: ${token.error}${desc}`);
  }

  const accessToken = token.access_token;
  const expiresIn = token.expires_in;

  if (!accessToken || !expiresIn) {
    throw new Error("OAuth token request returned no access_token/expires_in.");
  }

  const email = await fetchUserEmail(accessToken);

  return {
    accessToken,
    expiresIn,
    email
  };
}
