export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  driveId?: string; // Null for non-Shared Drive files.  TODO: Do we really need this?
  trashed: boolean;
  shortcutDetails?: {
    targetId: string;
    targetMimeType: string;
  };
  owners: Array<{ emailAddress?: string }>;
  createdTime?: string;
  modifiedTime?: string;
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS =
  "id,name,mimeType,parents,driveId,trashed,shortcutDetails(targetId,targetMimeType),owners(emailAddress),createdTime,modifiedTime";

export class DriveClient {
  constructor(private readonly accessToken: string) {
    if (!accessToken) throw new Error("access token required");
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const resp = await fetch(`${DRIVE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Drive API ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  async getFile(fileId: string): Promise<DriveFile> {
    return this.request<DriveFile>(
      `/files/${fileId}?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
      {
        method: "GET",
      },
    );
  }

  async listChildren(parentId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        files: DriveFile[];
        nextPageToken?: string;
      }>(
        `/files?q='${parentId}' in parents and trashed=false&includeItemsFromAllDrives=true&supportsAllDrives=true&pageSize=1000&fields=${encodeURIComponent(
          `files(${FILE_FIELDS}),nextPageToken`,
        )}${pageToken ? `&pageToken=${pageToken}` : ""}`,
        { method: "GET" },
      );
      files.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }

  async createFolder(name: string, parentId: string, driveId: string): Promise<DriveFile> {
    return this.request<DriveFile>("/files?supportsAllDrives=true", {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        driveId,
        supportsAllDrives: true,
      }),
    });
  }

  async createSpreadsheet(name: string, parentId: string, driveId: string): Promise<DriveFile> {
    return this.request<DriveFile>("/files?supportsAllDrives=true", {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [parentId],
        driveId,
        supportsAllDrives: true,
      }),
    });
  }

  async moveFile(fileId: string, destParentId: string, removeParents: string[]): Promise<DriveFile> {
    const remove = removeParents.join(",");
    return this.request<DriveFile>(
      `/files/${fileId}?supportsAllDrives=true&addParents=${destParentId}&removeParents=${encodeURIComponent(remove)}`,
      { method: "PATCH", body: "{}" },
    );
  }
}
