export interface OAuthConfig {
  clientId: string;
}

export interface AdminConfig {
  sourceRootFolderId: string;
  destinationManifestFolderId: string;
  manifestFilename: string;
}

// TODO: Fill these with real IDs/client once ready to run the spike locally.
export const oauthConfig: OAuthConfig = {
  clientId: "REPLACE_WITH_OAUTH_CLIENT_ID"
};

export const adminConfig: AdminConfig = {
  sourceRootFolderId: "REPLACE_WITH_SOURCE_ROOT_FOLDER_ID",
  destinationManifestFolderId: "REPLACE_WITH_DESTINATION_JOB_FOLDER_ID",
  manifestFilename: "spike-3-manifest.csv"
};
