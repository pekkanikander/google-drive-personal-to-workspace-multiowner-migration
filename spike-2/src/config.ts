declare const process: { env: Record<string, string | undefined> };

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const clientSecret =
  (process.env.SPIKE2_CLIENT_SECRET as string | undefined) ?? "";

// TODO: Replace the placeholder client ID before running the spike locally.
export const oauthConfig: OAuthConfig = {
  clientId:
    "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com",
  clientSecret,
  redirectUri: "http://localhost:8081/callback.html"
};
