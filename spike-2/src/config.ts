export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// TODO: Replace the placeholder values before running the spike locally.
export const oauthConfig: OAuthConfig = {
  clientId: "REPLACE_WITH_OAUTH_CLIENT_ID",
  clientSecret: "REPLACE_WITH_OAUTH_CLIENT_SECRET",
  redirectUri: "http://localhost:8081/callback.html"
};
