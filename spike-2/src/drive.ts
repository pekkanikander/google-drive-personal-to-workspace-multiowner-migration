export interface FileOpResult {
  id: string;
  name?: string;
  webViewLink?: string;
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Drive request failed: ${errorBody}`);
  }
  return response.json();
}

export async function moveFile(
  accessToken: string,
  fileId: string,
  destinationFolderId: string
): Promise<FileOpResult> {
  const metadata = await fetchJson<{ parents?: string[] }>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const existingParents = metadata.parents ?? [];
  const params = new URLSearchParams({
    supportsAllDrives: "true",
    addParents: destinationFolderId
  });
  if (existingParents.length > 0) {
    params.set("removeParents", existingParents.join(","));
  }

  return fetchJson<FileOpResult>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    }
  );
}
