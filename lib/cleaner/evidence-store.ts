import type { EvidenceDestination } from "./evidence-destination";
export type EvidenceScope = { draftIdentity: string; jobId: string; templateId: string; formRevision: string };
export type EvidenceReceipt = { key: string; url: string; kind: "image" | "video" | "file"; name?: string };
export type EvidenceRecord = EvidenceScope & {
  id: string; fieldId: string; filename: string; mime: string; blob: Blob;
  destination?: EvidenceDestination; destinationVersion?: number;
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
    tx.oncomplete = () => { resolve(result); if (mode === "readwrite" && typeof window !== "undefined") window.dispatchEvent(new Event("cleaner-evidence-changed")); };
    tx.onabort = () => reject(tx.error ?? new Error("Device recovery save failed. Keep the original file."));
    tx.onerror = () => { /* transaction abort is the terminal error */ };
    try { const req = operation(tx.objectStore("evidence")); req.onsuccess = () => { result = req.result; }; }
    catch (error) { tx.abort(); reject(error); }
  });
}
// Session-only backup: never promise recovery after the page closes.
const fallback = new Map<string, EvidenceRecord>();
const cleared = new Set<string>();
const pending = new Map<string, Promise<void>>();
let incompleteRecovery = false;
export function isEvidenceVolatile(id: string) { return fallback.has(id); }
/** A fallback-only list cannot establish that all device evidence was recovered. */
export function isEvidenceRecoveryIncomplete() { return incompleteRecovery; }
function changed(id: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("cleaner-evidence-changed"));
  window.dispatchEvent(new CustomEvent("sneek:evidence-volatile", { detail: { id, volatile: fallback.has(id) } }));
}
function serial(id: string, action: () => Promise<void>) {
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  pending.set(id, next);
  void next.finally(() => { if (pending.get(id) === next) pending.delete(id); }).catch(() => undefined);
  return next;
}
export function putEvidence(record: EvidenceRecord): Promise<void> {
  // Snapshot mutable metadata; Blob payloads are immutable and retained by reference.
  const snapshot: EvidenceRecord = { ...record, receipt: record.receipt ? { ...record.receipt } : undefined, allocation: record.allocation ? { ...record.allocation } : undefined, destination: record.destination ? { ...record.destination } : undefined };
  return serial(record.id, async () => {
    try {
      await request("readwrite", store => store.put(snapshot));
      fallback.delete(snapshot.id);
    } catch {
      // Quota, unavailable storage, and late transaction aborts must not lose the
      // original, prepared bytes, server allocation or acknowledged receipt.
      fallback.set(snapshot.id, snapshot);
    }
    cleared.delete(snapshot.id);
    changed(snapshot.id);
  });
}
async function readCurrent(id: string) {
  if (cleared.has(id)) return undefined;
  const memory = fallback.get(id);
  if (memory) return memory;
  return request<EvidenceRecord | undefined>("readonly", store => store.get(id));
}
export async function getEvidence(id: string): Promise<EvidenceRecord | undefined> {
  await pending.get(id);
  return readCurrent(id);
}
export async function listEvidence(): Promise<EvidenceRecord[]> {
  await Promise.all(Array.from(pending.values()));
  try {
    const durable = await request<EvidenceRecord[]>("readonly", store => store.getAll());
    const merged = new Map(durable.filter(record => !cleared.has(record.id)).map(record => [record.id, record]));
    fallback.forEach((record, id) => merged.set(id, record));
    incompleteRecovery = false;
    return Array.from(merged.values());
  } catch (error) {
    incompleteRecovery = true;
    // Without known in-memory records, an unreadable store is not an empty store.
    if (!fallback.size) throw error;
    return Array.from(fallback.values());
  }
}
export async function clearAttachedEvidence(record: EvidenceRecord) {
  return serial(record.id, async () => {
    const current = await readCurrent(record.id);
    if (!current || !sameEvidenceScope(current, record) || !["attached", "detached"].includes(current.status)) throw new Error("Only acknowledged evidence can be cleared from this device.");
    try { await request("readwrite", store => store.delete(record.id)); }
    catch (error) {
      // A memory-only acknowledged record can be released even while storage is
      // unavailable. Suppress any older durable copy for the rest of this session.
      if (!fallback.has(record.id)) throw error;
    }
    fallback.delete(record.id);
    cleared.add(record.id);
    changed(record.id);
  });
}
export function sameEvidenceScope(record: EvidenceScope, scope: EvidenceScope) {
  return record.draftIdentity === scope.draftIdentity && record.jobId === scope.jobId &&
    record.templateId === scope.templateId && record.formRevision === scope.formRevision;
}
