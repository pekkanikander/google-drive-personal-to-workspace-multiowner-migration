// Minimal IndexedDB journal for pending writes.

// This is more a placeholder for future use.  For now, we use the Google Sheet's Log tab to store the journal.

const DB_VERSION = 1;

export interface JournalEntry {
  id: string; // unique key
  kind: "status" | "log";
  payload: unknown;
}

export class Journal {
  private dbPromise: Promise<IDBDatabase>;

  constructor(private readonly name = "mvp-alpha-journal", private readonly store = "entries") {
    this.dbPromise = this.open();
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.store)) {
          db.createObjectStore(this.store, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  async put(entry: JournalEntry): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.store, "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      tx.objectStore(this.store).put(entry);
    });
  }

  async getAll(): Promise<JournalEntry[]> {
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, "readonly");
      const req = tx.objectStore(this.store).getAll();
      req.onsuccess = () => resolve(req.result as JournalEntry[]);
      req.onerror = () => reject(req.error);
    });
  }

  async remove(ids: string[]): Promise<void> {
    const db = await this.dbPromise;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.store, "readwrite");
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      const store = tx.objectStore(this.store);
      ids.forEach((id) => store.delete(id));
    });
  }
}
