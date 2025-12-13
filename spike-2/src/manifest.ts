export interface Manifest {
  sourceFileId: string;
  allowedUsers: Record<string, string>;
}

// Inline manifest for the spike. Update the values locally as needed.
export const manifest: Manifest = {
  sourceFileId: "SOURCE_FILE_ID",
  allowedUsers: {
    "example.user@gmail.com": "DESTINATION_FOLDER_ID"
  }
};
