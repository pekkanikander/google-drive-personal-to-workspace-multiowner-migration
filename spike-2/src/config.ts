export interface OAuthConfig {
  clientId: string;
  redirectUri: string;
}

// TODO: Replace the placeholder client ID before running the spike locally.
export const oauthConfig: OAuthConfig = {
  clientId:
    "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com",
  redirectUri: "http://localhost:8081/callback.html"
};
