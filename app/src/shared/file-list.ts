import { DriveClient } from "./drive";
import { createRelativePathResolver } from "./paths";
import { ManifestStatus } from "./types";

export type FileListEntry = {
  rowIndex: number;
  name: string;
  parents: string[];
  owners: string[];
  status: ManifestStatus;
  workerSessionId?: string;
};

export type FileListRow = {
  entry: FileListEntry;
  statusEl: HTMLElement;
  ownerEl?: HTMLElement;
};

const STATUS_CLASSES = ["status-done", "status-failed", "status-ignored", "status-started", "status-pending"];

type RenderFileListOptions = {
  container: HTMLTableSectionElement;
  entries: FileListEntry[];
  drive: DriveClient;
  sourceRootId: string;
  statusLabelForEntry: (entry: FileListEntry) => string;
  ownerLabelForEntry?: (entry: FileListEntry) => string;
  showOwner?: boolean;
  maxItems?: number;
  setNote?: (note: string) => void;
};

export function statusClass(label: string): string {
  const normalized = label.trim().toUpperCase();
  if (normalized.startsWith("DONE")) return "status-done";
  if (normalized.startsWith("FAILED")) return "status-failed";
  if (normalized.startsWith("IGNORED")) return "status-ignored";
  if (normalized.startsWith("STARTED")) return "status-started";
  return "status-pending";
}

export function setFileStatus(el: HTMLElement, label: string) {
  el.textContent = label;
  STATUS_CLASSES.forEach((name) => el.classList.remove(name));
  el.classList.add(statusClass(label));
}

export function renderFileTable(options: RenderFileListOptions): Map<number, FileListRow> {
  const {
    container,
    entries,
    drive,
    sourceRootId,
    statusLabelForEntry,
    ownerLabelForEntry,
    showOwner = false,
    maxItems = 200,
    setNote,
  } = options;

  container.innerHTML = "";
  if (entries.length === 0) {
    if (setNote) setNote("");
    return new Map();
  }

  const shown = entries.slice(0, maxItems);
  const countNote =
    entries.length > maxItems
      ? `Showing first ${maxItems} of ${entries.length} files.`
      : `Showing ${entries.length} files.`;
  const note = `Paths shown relative to the source root. ${countNote}`;
  if (setNote) setNote(note);

  const resolver = createRelativePathResolver(drive, sourceRootId);
  const rows = new Map<number, FileListRow>();

  shown.forEach((entry) => {
    const parentId = entry.parents[0] ?? "";
    const tr = document.createElement("tr");
    const pathCell = document.createElement("td");
    const statusCell = document.createElement("td");
    pathCell.textContent = entry.name;
    statusCell.classList.add("file-status");
    setFileStatus(statusCell, statusLabelForEntry(entry));

    tr.appendChild(pathCell);

    let ownerCell: HTMLElement | undefined;
    if (showOwner) {
      ownerCell = document.createElement("td");
      const ownerText = ownerLabelForEntry ? ownerLabelForEntry(entry) : entry.owners.join("; ");
      ownerCell.textContent = ownerText || "-";
      tr.appendChild(ownerCell);
    }

    tr.appendChild(statusCell);
    container.appendChild(tr);
    rows.set(entry.rowIndex, { entry, statusEl: statusCell, ownerEl: ownerCell });

    void resolver
      .resolveFilePath(parentId, entry.name)
      .then((path) => {
        pathCell.textContent = path;
      })
      .catch(() => {
        pathCell.textContent = entry.name;
      });
  });

  return rows;
}
