import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceRecord } from "@/lib/cleaner/evidence-store";
const store = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", async original => ({
  ...await original<typeof import("@/lib/cleaner/evidence-store")>(), getEvidence: store.get, putEvidence: store.put,
}));
import { processEvidence, moveEvidence } from "@/lib/cleaner/evidence-client";
const scope = { jobId: "job", draftIdentity: "actor", templateId: "template", formRevision: "revision" };
const receipt = { key: "forms/cleaner/file.jpg", url: "https://media.invalid/file.jpg", kind: "image" as const };
let record: EvidenceRecord; let saved: EvidenceRecord; let fetcher: ReturnType<typeof vi.fn>;
let testRevision = 0;
beforeEach(() => {
  scope.formRevision = `revision-${++testRevision}`;
  record = { ...scope, id: "capture", fieldId: "photo", filename: "file.jpg", mime: "image/jpeg", blob: new Blob(["original"]),
    createdAt: 1, source: "camera", folder: "forms", status: "captured" };
  saved = record;
  store.get.mockReset().mockImplementation(async () => saved);
  store.put.mockReset().mockImplementation(async row => { saved = row; });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_: string, callback: () => Promise<unknown>) => callback() } });
  fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, captureId: "capture", key: receipt.key })));
  vi.stubGlobal("fetch", fetcher);
});
describe("durable evidence receipt recovery", () => {
  it("requires a matching strict acknowledgement before projecting a proposed move", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ draft: { evidenceReceipts: { capture: { ...record, key: receipt.key, version: 2, destination: { type: "bulkPool" } } } } })));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, captureId: "wrong", key: receipt.key, version: 3, destination: { type: "formField", fieldId: "proof" } })));
    await expect(moveEvidence(scope, receipt, { type: "bulkPool" }, { type: "formField", fieldId: "proof" }, { captureId: "capture", version: 2 })).rejects.toThrow("acknowledgement did not match");
    expect(store.put).not.toHaveBeenCalled();
  });
  it.each(["missing", "version", "capture", "destination"])("strict proposed move rejects %s receipt without a write", async changed => {
    const entry = { ...record, key: receipt.key, version: changed === "version" ? 3 : 2, destination: changed === "destination" ? { type: "formField", fieldId: "proof" } : { type: "bulkPool" } };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ draft: { evidenceReceipts: changed === "missing" ? {} : { [changed === "capture" ? "other" : "capture"]: entry } } })));
    await expect(moveEvidence(scope, receipt, { type: "bulkPool" }, { type: "formField", fieldId: "proof" }, { captureId: "capture", version: 2 })).rejects.toThrow("receipt changed");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(store.put).not.toHaveBeenCalled();
  });
  it("does not route a moved attached capture back into a stale field", async () => {
    saved = { ...record, destination: { type: "bulkPool" }, status: "attached", receipt };
    await expect(processEvidence(record, scope, vi.fn())).rejects.toThrow("moved to another destination");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("persists a versioned acknowledged move without uploading", async () => {
    record = { ...record, status: "attached", destination: { type: "bulkPool" }, receipt }; saved = record;
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ draft: { evidenceReceipts: { capture: { ...record, key: receipt.key, version: 0 } } } })));
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, version: 1 })));
    await moveEvidence(scope, receipt, { type: "bulkPool" }, { type: "formField", fieldId: "proof" });
    expect(saved.destination).toEqual({ type: "formField", fieldId: "proof" }); expect(saved.destinationVersion).toBe(1);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).move).toEqual({ from: { type: "bulkPool" }, version: 0 });
    expect(JSON.parse(fetcher.mock.calls[1][1].body).legacy).toBe(true);
  });
  it("reconciles an already committed move after lost acknowledgement from the server ledger", async () => {
    saved = { ...record, destination: { type: "bulkPool" }, receipt, status: "attached" };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ draft: { evidenceReceipts: { capture: { ...record, key: receipt.key, destination: { type: "formField", fieldId: "proof" }, version: 1 } } } })));
    await moveEvidence(scope, receipt, { type: "bulkPool" }, { type: "formField", fieldId: "proof" });
    expect(saved.destinationVersion).toBe(1); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("recovers exact allocated key after reload without allocating or transferring another blob", async () => {
    record = { ...record, status: "uploading", allocation: { key: receipt.key, uploadId: "allocated-upload" } }; saved = record;
    const upload = vi.fn();
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, captureId: record.id, key: receipt.key, media: receipt })));
    await expect(processEvidence(record, scope, upload)).resolves.toEqual({ ...receipt, name: record.filename });
    expect(upload).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body).key).toBe(record.allocation.key);
    expect(saved.status).toBe("attached"); expect(saved.blob).toBe(record.blob);
  });
  it("keeps exact-key recovery retryable after not-found without blind retransmission", async () => {
    record = { ...record, status: "uploading", allocation: { key: receipt.key, uploadId: "allocated-upload" } }; saved = record;
    const upload = vi.fn();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Uploaded evidence was not found" }), { status: 409 }));
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("not found");
    expect(saved.status).toBe("uploading"); expect(saved.allocation).toEqual(record.allocation);
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, captureId: record.id, key: receipt.key, media: receipt })));
    await processEvidence(saved, scope, upload); expect(upload).not.toHaveBeenCalled();
  });
  it("rejects a reconciliation response without matching canonical media", async () => {
    record = { ...record, status: "uploading", allocation: { key: receipt.key, uploadId: "allocated-upload" } }; saved = record;
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, captureId: record.id, key: receipt.key, media: { ...receipt, key: "wrong-key" } })));
    await expect(processEvidence(record, scope, vi.fn())).rejects.toThrow("invalid receipt");
    expect(saved.status).toBe("uploading"); expect(saved.receipt).toBeUndefined();
  });
  it("keeps preparation failures retryable before network starts", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new Error("preparation failed")).mockResolvedValueOnce(receipt);
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("preparation failed");
    expect(saved.status).toBe("preparing");
    await processEvidence(saved, scope, upload); expect(upload).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite an explicit detach when an old attachment ACK arrives", async () => {
    fetcher.mockImplementation(async () => { saved = { ...saved, status: "detached" }; return new Response(JSON.stringify({ ok: true, captureId: "capture", key: receipt.key })); });
    await expect(processEvidence(record, scope, async () => receipt)).rejects.toThrow("removed while its acknowledgement");
    expect(saved.status).toBe("detached");
  });
  it("never reuploads after remote success followed by two failed receipt writes", async () => {
    record.id = "quota-capture"; saved = record;
    const upload = vi.fn(async (_record, beforeNetwork) => { await beforeNetwork(); return receipt; });
    store.put.mockImplementation(async row => { if (row.receipt) throw new Error("quota"); saved = row; });
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("quota");
    expect(saved.status).toBe("uploading"); expect(saved.receipt).toBeUndefined();
    store.put.mockImplementation(async row => { saved = row; });
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, captureId: record.id, key: receipt.key })));
    await processEvidence(saved, scope, upload);
    expect(upload).toHaveBeenCalledTimes(1); expect(saved.status).toBe("attached");
  });
  it("blocks automatic reupload after an uncertain network response or restart", async () => {
    record.id = "uncertain-capture"; saved = record;
    const upload = vi.fn(async (_record, beforeNetwork) => { await beforeNetwork(); throw new Error("remote committed but response lost"); });
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("response lost");
    expect(saved.status).toBe("uploading");
    await expect(processEvidence(saved, scope, upload)).rejects.toThrow("outcome is uncertain");
    expect(upload).toHaveBeenCalledTimes(1); expect(fetcher).not.toHaveBeenCalled();
  });
  it("persists upload receipt before attachment and keeps original after acknowledgement", async () => {
    fetcher.mockImplementation(async () => { expect(saved.status).toBe("uploaded"); expect(saved.receipt).toEqual(receipt);
      return new Response(JSON.stringify({ ok: true, captureId: "capture", key: receipt.key })); });
    await processEvidence(record, scope, async () => receipt);
    expect(saved.status).toBe("attached"); expect(saved.blob).toBe(record.blob);
  });
  it("retries only attachment after a lost acknowledgement", async () => {
    const upload = vi.fn(async () => receipt);
    fetcher.mockRejectedValueOnce(new Error("connection lost"));
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("connection lost");
    expect(saved.receipt).toEqual(receipt);
    await processEvidence(saved, scope, upload);
    expect(upload).toHaveBeenCalledTimes(1); expect(saved.status).toBe("attached");
  });
  it("requires a matching acknowledgement, retaining the uploaded receipt on malformed success", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, captureId: "other", key: receipt.key })));
    await expect(processEvidence(record, scope, async () => receipt)).rejects.toThrow("could not be confirmed");
    expect(saved.receipt).toEqual(receipt); expect(saved.status).toBe("uploaded");
  });
  it.each(["draftIdentity", "formRevision", "jobId", "templateId"] as const)("rejects changed %s before network", async key => {
    const upload = vi.fn();
    await expect(processEvidence(record, { ...scope, [key]: "changed" }, upload)).rejects.toThrow("older form");
    expect(upload).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not upload when the initial durable transition fails", async () => {
    store.put.mockRejectedValue(new Error("quota exceeded")); const upload = vi.fn();
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("quota exceeded");
    expect(upload).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps prepared bytes across receipt writes", async () => {
    const prepared = new Blob(["prepared"]);
    await processEvidence(record, scope, async () => { saved = { ...saved, prepared }; return receipt; });
    expect(saved.prepared).toBe(prepared);
  });
  it("refuses removed attachments and unsupported cross-tab coordination", async () => {
    saved = { ...saved, status: "detached" };
    await expect(processEvidence(saved, scope, vi.fn())).rejects.toThrow("explicitly removed");
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(processEvidence(record, scope, vi.fn())).rejects.toThrow("coordinate");
  });
});
