const DB_NAME = "sneek-uploads";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

export interface DraftRecord {
  id: string;
  filename: string;
  size: number;
  mime: string;
  jobId?: string;
  uploadedAt: number;
  blob: Blob;
  status: "pending" | "uploading" | "failed";
  error?: string;
  attempts: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A blocked request cannot be cancelled; close its eventual connection.
      if (blocked) {
        db.close();
        return;
      }
      const invalidate = () => {
        if (dbPromise === opening) dbPromise = null;
      };
      db.onversionchange = () => {
        invalidate();
        db.close();
      };
      db.onclose = invalidate;
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("Unable to open upload drafts"));
    req.onblocked = () => {
      blocked = true;
      reject(new Error("Upload drafts database is blocked by another connection"));
    };
  });
  dbPromise = opening;
  void opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

async function transaction(mode: IDBTransactionMode): Promise<IDBTransaction> {
  for (let attempt = 0; ; attempt++) {
    const db = await openDB();
    try {
      return db.transaction(STORE_NAME, mode);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "InvalidStateError") throw error;
      // Explicit close() does not emit close. Retry only transaction creation,
      // never a write that may already have been committed.
      const cached = dbPromise;
      if (cached && await cached === db && dbPromise === cached) dbPromise = null;
      db.close();
      if (attempt > 0) throw error;
    }
  }
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  request: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const tx = await transaction(mode);
  return new Promise((resolve, reject) => {
    let result: T;
    let requestError: DOMException | null = null;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? requestError ?? new DOMException("Upload drafts transaction aborted", "AbortError"));
    // Request errors bubble before the transaction's terminal event.
    tx.onerror = () => { requestError ??= tx.error; };
    try {
      const req = request(tx.objectStore(STORE_NAME));
      req.onsuccess = () => { result = req.result; };
      req.onerror = () => { requestError = req.error; };
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be inactive. */ }
      reject(error);
    }
  });
}

export async function saveDraft(record: DraftRecord): Promise<void> {
  await runRequest("readwrite", store => store.put(record));
}

export async function getDraft(id: string): Promise<DraftRecord | null> {
  return (await runRequest<DraftRecord | undefined>("readonly", store => store.get(id))) ?? null;
}

export async function listDrafts(): Promise<DraftRecord[]> {
  return (await runRequest<DraftRecord[]>("readonly", store => store.getAll())) ?? [];
}

export async function deleteDraft(id: string): Promise<void> {
  await runRequest("readwrite", store => store.delete(id));
}
