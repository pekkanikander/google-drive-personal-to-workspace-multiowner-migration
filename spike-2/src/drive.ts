export interface CopyResult {
  id: string;
  name?: string;
  webViewLink?: string;
}

export async function copyFile(
  accessToken: string,
  sourceFileId: string,
  destinationFolderId: string
): Promise<CopyResult> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sourceFileId)}/copy?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ parents: [destinationFolderId] })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Drive copy failed: ${errorBody}`);
  }

  return response.json();
}
