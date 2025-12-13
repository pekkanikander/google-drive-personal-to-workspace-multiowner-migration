import { oauthConfig } from "./config";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive"
];

function randomString(length = 64): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => (b % 62))
    .map((n) => {
      if (n < 10) return String.fromCharCode(48 + n);
      if (n < 36) return String.fromCharCode(55 + n);
      return String.fromCharCode(61 + n);
    })
    .join("");
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  return crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseIdToken(idToken?: string): { email?: string } {
  if (!idToken) return {};
  const [, payload] = idToken.split(".");
  if (!payload) return {};
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

function openPopup(url: string): Window | null {
  const width = 500;
  const height = 650;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  return window.open(
    url,
    "oauth_popup",
    `width=${width},height=${height},left=${left},top=${top}`
  );
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken?: string;
  email?: string;
}

export async function runPkceAuth(): Promise<AuthResponse> {
  const state = randomString(32);
  const codeVerifier = randomString(64);
  const challengeBuffer = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(challengeBuffer);

  const params = new URLSearchParams({
    client_id: oauthConfig.clientId,
    redirect_uri: oauthConfig.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    include_granted_scopes: "true",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;
  const popup = openPopup(authUrl);
  if (!popup) {
    throw new Error("Popup blocked. Please allow popups for this site.");
  }

  const code = await new Promise<string>((resolve, reject) => {
    const popupChecker = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(popupChecker);
        window.removeEventListener("message", messageHandler);
        reject(new Error("Popup was closed before completing authorisation."));
      }
    }, 500);

    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as { code?: string; state?: string; error?: string };
      if (!data || data.state !== state) {
        return;
      }
      window.clearInterval(popupChecker);
      window.removeEventListener("message", messageHandler);
      if (data.error) {
        reject(new Error(data.error));
      } else if (!data.code) {
        reject(new Error("No authorization code received."));
      } else {
        resolve(data.code);
      }
    };
    window.addEventListener("message", messageHandler);
  });

  const tokenPayload = new URLSearchParams({
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: oauthConfig.redirectUri,
    grant_type: "authorization_code"
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: tokenPayload.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  const tokenData = await response.json();
  const { email } = parseIdToken(tokenData.id_token);

  return {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
    refreshToken: tokenData.refresh_token,
    email
  };
}
