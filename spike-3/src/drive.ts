export interface DriveItem {
  id: string;
  name?: string;
  mimeType?: string;
  parents?: string[];
  owners?: Array<{ emailAddress?: string }>;
  driveId?: string;
  trashed?: boolean;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
  permissions?: Array<{ type?: string; role?: string; emailAddress?: string }>;
  createdTime?: string;
  modifiedTime?: string;
}

interface ListPage {
  items: DriveItem[];
  nextPageToken?: string;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Drive API error ${res.status}: ${res.statusText}. Body: ${bodyText}`);
  }
  return (bodyText ? (JSON.parse(bodyText) as T) : ({} as T));
}

async function listFolderOnce(accessToken: string, folderId: string, pageToken?: string): Promise<ListPage> {
  const fields = [
    "nextPageToken",
    "files(id,name,mimeType,parents,owners(emailAddress),driveId,trashed,shortcutDetails(targetId,targetMimeType),permissions(emailAddress,role,type),createdTime,modifiedTime)"
  ].join(",");

  const params = new URLSearchParams({
    q: `'${folderId}' in parents`,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    fields
  });

  if (pageToken) params.set("pageToken", pageToken);

  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;

  const page = await fetchJson<{ files: DriveItem[]; nextPageToken?: string }>(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return {
    items: page.files ?? [],
    nextPageToken: page.nextPageToken
  };
}

export async function enumerateTree(
  accessToken: string,
  rootFolderId: string,
  onPage?: (info: { folderId: string; items: number; page: number }) => void
): Promise<DriveItem[]> {
  const all: DriveItem[] = [];
  const queue: string[] = [rootFolderId];

  while (queue.length > 0) {
    const folderId = queue.shift() as string;
    let pageToken: string | undefined;
    let pageIndex = 0;

    do {
      const page = await listFolderOnce(accessToken, folderId, pageToken);
      all.push(...page.items);

      for (const item of page.items) {
        if (item.mimeType === FOLDER_MIME && item.id) {
          queue.push(item.id);
        }
      }

      pageIndex += 1;
      if (onPage) onPage({ folderId, items: page.items.length, page: pageIndex });

      pageToken = page.nextPageToken;
    } while (pageToken);
  }

  return all;
}

export async function uploadCsvToDrive(
  accessToken: string,
  destinationFolderId: string,
  filename: string,
  csvContent: string
): Promise<string> {
  const boundary = "-------drive-spike-3-" + Math.random().toString(16).slice(2);
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;

  const metadata = {
    name: filename,
    parents: [destinationFolderId],
    mimeType: "text/csv"
  };

  const body = [
    delimiter,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    delimiter,
    "Content-Type: text/csv; charset=UTF-8",
    "",
    csvContent,
    closeDelimiter,
    ""
  ].join("\r\n");

  const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to upload CSV: ${res.status} ${res.statusText}. Body: ${bodyText}`);
  }

  const json = bodyText ? (JSON.parse(bodyText) as { id?: string }) : {};
  if (!json.id) {
    throw new Error("Upload succeeded but response missing file id.");
  }
  return json.id;
}
