export interface StatusUpdateRecord {
  rowIndex: number;
  status: string;
  workerSessionId: string;
}

export interface LogEntryRecord {
  timestamp: string;
  event: string;
  userEmail: string;
  rowIndex: number | string;
  fileId?: string;
  sessionId: string;
  details?: string;
}

export interface JournalState {
  statuses: StatusUpdateRecord[];
  logs: LogEntryRecord[];
}

const DB_NAME = "spike4-journal";
const STORE_NAME = "pending";
const KEY = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    req.onsuccess = () => resolve(req.result);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB operation failed"));
  });
}

export async function loadJournal(): Promise<JournalState> {
  const existing = await withStore<JournalState | undefined>("readonly", (store) => store.get(KEY));
  if (!existing) {
    return { statuses: [], logs: [] };
  }
  return existing;
}

export async function saveJournal(state: JournalState): Promise<void> {
  await withStore("readwrite", (store) => store.put(state, KEY));
}

export async function clearJournal(): Promise<void> {
  await withStore("readwrite", (store) => store.put({ statuses: [], logs: [] }, KEY));
}
