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
  clientId: "554015392094-jbp76oeeqr52d4ol8c261fg398cvecio.apps.googleusercontent.com"
};

export const adminConfig: AdminConfig = {
  sourceRootFolderId: "1BOVZer9jAPNhHS7syxLf99n9Tf-27B4O",
  destinationManifestFolderId: "10Px9dQKe2WeBl1YGf1BHafs5C4MicfWq",
  manifestFilename: "spike-3-manifest.csv"
};
