export type EvidenceScope = { draftIdentity: string; jobId: string; templateId: string; formRevision: string };
export type EvidenceReceipt = { key: string; url: string; kind: "image" | "video" | "file"; name?: string };
export type EvidenceRecord = EvidenceScope & {
  id: string; fieldId: string; filename: string; mime: string; blob: Blob;
  createdAt: number; folder: string; source: "camera" | "gallery";
  status: "captured" | "preparing" | "uploading" | "uploaded" | "attached" | "detached";
  prepared?: Blob; preparedName?: string; stamp?: import("@/lib/uploads/stamp").StampOptions | null;
  /** Server-allocated upload identity, committed before any part is sent. */
  allocation?: { key: string; uploadId: string };
  receipt?: EvidenceReceipt; error?: string;
};
let connection: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("Device recovery storage is unavailable. Keep the original file and try again."));
  if (connection) return connection;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("sneek-cleaner-evidence-v1", 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("evidence", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error("Close other open job tabs to enable device recovery.")); };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = null; };
      db.onclose = () => { connection = null; };
      resolve(db);
    };
  });
  connection = pending;
  void pending.catch(() => { if (connection === pending) connection = null; });
  return pending;
}
async function request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("evidence", mode); let result: T;
    tx.oncomplete = () => { resolve(result); if (mode === "readwrite") window.dispatchEvent(new Event("cleaner-evidence-changed")); };
    tx.onabort = () => reject(tx.error ?? new Error("Device recovery save failed. Keep the original file."));
    tx.onerror = () => { /* transaction abort is the terminal error */ };
    try { const req = operation(tx.objectStore("evidence")); req.onsuccess = () => { result = req.result; }; }
    catch (error) { tx.abort(); reject(error); }
  });
}
export const putEvidence = (record: EvidenceRecord) => request("readwrite", store => store.put(record)).then(() => undefined);
export const getEvidence = (id: string) => request<EvidenceRecord | undefined>("readonly", store => store.get(id));
export const listEvidence = () => request<EvidenceRecord[]>("readonly", store => store.getAll());
export async function clearAttachedEvidence(record: EvidenceRecord) {
  const current = await getEvidence(record.id);
  if (!current || current.draftIdentity !== record.draftIdentity || !["attached", "detached"].includes(current.status)) throw new Error("Only acknowledged evidence can be cleared from this device.");
  await request("readwrite", store => store.delete(record.id));
}
export function sameEvidenceScope(record: EvidenceScope, scope: EvidenceScope) {
  return record.draftIdentity === scope.draftIdentity && record.jobId === scope.jobId &&
    record.templateId === scope.templateId && record.formRevision === scope.formRevision;
}
