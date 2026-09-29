import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { EvidenceRecord } from "@/lib/cleaner/evidence-store";
let store: typeof import("@/lib/cleaner/evidence-store");
const rows = new Map<string, EvidenceRecord>();
let failWrite = false, failRead = false, lateAbort = false;
let heldWrite: (() => void) | undefined, holdNext = false;
const record = (id = "capture"): EvidenceRecord => ({ id, draftIdentity: "actor", jobId: "job", templateId: "form", formRevision: "rev", fieldId: "photo", filename: "original.mp4", mime: "video/mp4", blob: new Blob(["original"]), createdAt: 1, folder: "forms", source: "camera", status: "captured" });
function indexedDatabase() {
 const database = { close: vi.fn(), createObjectStore: vi.fn(), transaction: (_name: string, mode: string) => {
  const tx: any = { error: null, abort() { tx.error = new Error("aborted"); tx.onabort?.(); } };
  const operation = (kind: string, value?: any) => {
   const req: any = {};
   const finish = () => {
    if ((mode === "readwrite" && failWrite) || (mode === "readonly" && failRead)) { tx.error = new DOMException("Storage full", "QuotaExceededError"); tx.onabort?.(); return; }
    req.result = kind === "get" ? rows.get(value) : kind === "getAll" ? Array.from(rows.values()) : value?.id;
    req.onsuccess?.();
    if (mode === "readwrite" && lateAbort) { tx.error = new Error("Late commit failure"); tx.onabort?.(); return; }
    if (kind === "put") rows.set(value.id, value); if (kind === "delete") rows.delete(value);
    tx.oncomplete?.();
   };
   if (mode === "readwrite" && holdNext) { holdNext = false; heldWrite = finish; } else queueMicrotask(finish);
   return req;
  };
  tx.objectStore = () => ({ put: (value: any) => operation("put", value), get: (id: string) => operation("get", id), getAll: () => operation("getAll"), delete: (id: string) => operation("delete", id) }); return tx;
 } };
 return { open: () => { const req: any = { result: database }; queueMicrotask(() => req.onsuccess?.()); return req; } };
}
beforeEach(async () => { vi.resetModules(); rows.clear(); failWrite = false; failRead = false; lateAbort = false; holdNext = false; heldWrite = undefined; vi.stubGlobal("indexedDB", indexedDatabase()); store = await import("@/lib/cleaner/evidence-store"); });
afterEach(() => vi.unstubAllGlobals());
it("keeps original and prepared video plus allocation after quota failure and emits the volatile event", async () => {
 failWrite = true; const listener = vi.fn(); window.addEventListener("sneek:evidence-volatile", listener);
 const original = { ...record(), prepared: new Blob(["prepared"]), preparedName: "compressed.mp4", allocation: { key: "owned-key", uploadId: "multipart" } };
 await store.putEvidence(original); expect(store.isEvidenceVolatile(original.id)).toBe(true);
 const retained = await store.getEvidence(original.id); expect(retained).toMatchObject({ filename: "original.mp4", preparedName: "compressed.mp4", allocation: original.allocation }); expect(retained?.blob).toBe(original.blob); expect(retained?.prepared).toBe(original.prepared);
 expect(listener.mock.calls[0][0].detail).toEqual({ id: original.id, volatile: true }); window.removeEventListener("sneek:evidence-volatile", listener);
});
it("retains writes when IndexedDB is unavailable without inventing unrelated records", async () => {
 vi.stubGlobal("indexedDB", undefined); await store.putEvidence(record());
 expect((await store.getEvidence("capture"))?.id).toBe("capture"); await expect(store.getEvidence("unknown")).rejects.toThrow("unavailable");
 expect(await store.listEvidence()).toHaveLength(1); expect(store.isEvidenceRecoveryIncomplete()).toBe(true);
});
it("new memory ACK overrides old durable captured state and a future successful write clears fallback", async () => {
 await store.putEvidence(record()); failWrite = true;
 const acknowledged = { ...record(), status: "attached" as const, receipt: { key: "uploaded-key", url: "https://storage.invalid/key", kind: "video" as const } };
 await store.putEvidence(acknowledged);
 expect((await store.listEvidence())[0]).toMatchObject({ status: "attached", receipt: acknowledged.receipt });
 expect(rows.get("capture")?.status).toBe("captured");
 failWrite = false; await store.putEvidence(acknowledged); expect(store.isEvidenceVolatile("capture")).toBe(false); expect(rows.get("capture")?.status).toBe("attached");
});
it("retains the whole record after request success followed by transaction abort", async () => {
 lateAbort = true; await store.putEvidence({ ...record(), status: "uploaded", receipt: { key: "server", url: "https://storage.invalid/server", kind: "video" } });
 expect(rows.size).toBe(0); expect((await store.getEvidence("capture"))?.receipt?.key).toBe("server");
});
it("serializes a late old write failure before the newer server ACK", async () => {
 holdNext = true; const first = store.putEvidence(record()); await vi.waitFor(() => expect(heldWrite).toBeDefined());
 const latest = store.putEvidence({ ...record(), status: "attached", receipt: { key: "ack", url: "https://storage.invalid/ack", kind: "video" } });
 failWrite = true; heldWrite!(); await Promise.all([first, latest]); expect((await store.getEvidence("capture"))?.status).toBe("attached");
});
it("never converts an unreadable store into an empty list and clears incomplete state only after a full read", async () => {
 failRead = true; await expect(store.listEvidence()).rejects.toThrow(); expect(store.isEvidenceRecoveryIncomplete()).toBe(true);
 failWrite = true; await store.putEvidence(record()); expect(await store.listEvidence()).toHaveLength(1); expect(store.isEvidenceRecoveryIncomplete()).toBe(true);
 failRead = false; expect(await store.listEvidence()).toHaveLength(1); expect(store.isEvidenceRecoveryIncomplete()).toBe(false);
});
it.each(["attached", "detached"] as const)("clears acknowledged %s memory and suppresses its older durable record when deletion fails", async status => {
 await store.putEvidence(record()); failWrite = true; const acknowledged = { ...record(), status }; await store.putEvidence(acknowledged);
 await store.clearAttachedEvidence(acknowledged); expect(store.isEvidenceVolatile("capture")).toBe(false); expect(await store.getEvidence("capture")).toBeUndefined(); expect(await store.listEvidence()).toEqual([]);
 failRead = true; await expect(store.listEvidence()).rejects.toThrow();
});
it("does not clear unacknowledged records or records belonging to another scope", async () => {
 failWrite = true; await store.putEvidence(record()); await expect(store.clearAttachedEvidence(record())).rejects.toThrow("Only acknowledged");
 await store.putEvidence({ ...record(), status: "attached" }); await expect(store.clearAttachedEvidence({ ...record(), jobId: "other" })).rejects.toThrow("Only acknowledged"); expect(store.isEvidenceVolatile("capture")).toBe(true);
});
