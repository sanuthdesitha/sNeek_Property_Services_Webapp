import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceRecord } from "@/lib/cleaner/evidence-store";
const store = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", async original => ({
  ...await original<typeof import("@/lib/cleaner/evidence-store")>(), getEvidence: store.get, putEvidence: store.put,
}));
import { processEvidence, moveEvidence, moveEvidenceBatch, attachEvidence, removeEvidence, cancelPendingEvidence, withEvidenceSubmissionLock } from "@/lib/cleaner/evidence-client";
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
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_: string, options: any, callback?: any) => (callback ?? options)({}) } });
  fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, captureId: "capture", key: receipt.key })));
  vi.stubGlobal("fetch", fetcher);
});
describe("durable evidence receipt recovery", () => {
  it("returns the latest uploaded key after waiting for the capture lock", async () => {
    saved = { ...record, status: "attached", receipt };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, captureId: record.id, detached: true })));
    expect(await cancelPendingEvidence(record, scope)).toBe(receipt.key);
    expect(saved.status).toBe("detached"); expect(saved.receipt).toEqual(receipt);
  });
  it("requires capture cancellation acknowledgement and retains original bytes", async () => {
    saved = { ...record, status: "uploading" };
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, captureId: record.id, detached: true })));
    await cancelPendingEvidence(record, scope);
    expect(saved.status).toBe("detached"); expect(saved.blob).toBe(record.blob);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ cancelPending: true, captureId: record.id, formRevision: scope.formRevision });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).key).toBeUndefined();
  });
  it("does not discard an original on rejected or mismatched cancellation acknowledgement", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, captureId: "other", detached: true })));
    await expect(cancelPendingEvidence(record, scope)).rejects.toThrow("not confirmed");
    expect(store.put).not.toHaveBeenCalled(); expect(saved.blob).toBe(record.blob);
  });
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

it("refuses upload admission while the job submission lock is held without sending bytes", async () => {
  Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async (_name:string,options:any,callback?:any)=>(callback ?? options)(null)}});
  const upload=vi.fn();await expect(processEvidence(record,scope,upload)).rejects.toThrow("being submitted");expect(upload).not.toHaveBeenCalled();expect(store.put).not.toHaveBeenCalled();
});
it("refuses submission immediately when another tab owns an active upload job lock",async()=>{
  Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async (_name:string,options:any,callback:any)=>{expect(options).toEqual({mode:"exclusive",ifAvailable:true});return callback(null)}}});
  const submit=vi.fn();await expect(withEvidenceSubmissionLock(scope,submit)).rejects.toThrow("upload is still running");expect(submit).not.toHaveBeenCalled();
});
it("keeps the exclusive job lock throughout asynchronous submission",async()=>{
  let held=false;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});
  Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async (_name:string,_options:any,callback:any)=>{held=true;try{return await callback({})}finally{held=false}}}});
  const result=withEvidenceSubmissionLock(scope,async()=>{expect(held).toBe(true);await pending;expect(held).toBe(true);return "saved"});
  await Promise.resolve();expect(held).toBe(true);release();expect(await result).toBe("saved");expect(held).toBe(false);
});
it("rejects a removal acknowledgement for another photo and retains the original", async () => {
  const { removeEvidence } = await import("@/lib/cleaner/evidence-client");
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, key: "other.jpg" })));
  await expect(removeEvidence(scope, receipt.key)).rejects.toThrow("not confirmed");
  expect(store.put).not.toHaveBeenCalled(); expect(saved.blob).toBe(record.blob);
});

it("batch assignment reads the draft once and confirms each move before updating UI", async () => {
 const { moveEvidenceBatch } = await import("@/lib/cleaner/evidence-client");
 const items = ["one", "two", "three"].map(id => ({ media: { key: id, url: `/${id}.jpg`, kind: "image" as const }, from: { type: "bulkPool" as const } }));
 const target = { type: "formField" as const, fieldId: "photo" };
 fetcher.mockImplementation(async (_url, init) => {
  if (!init?.method) return new Response(JSON.stringify({ draft: { evidenceReceipts: Object.fromEntries(items.map(item => [item.media.key, { key: item.media.key, draftIdentity: scope.draftIdentity, formRevision: scope.formRevision, destination: item.from, version: 0 }])) } }));
  const body = JSON.parse(init.body);
  return new Response(JSON.stringify({ ok: true, captureId: body.captureId, key: body.key, version: 1, destination: target }));
 });
 const moved = vi.fn();
 await moveEvidenceBatch(scope, items, target, moved, () => true);
 expect(fetcher).toHaveBeenCalledTimes(4);
 expect(moved.mock.calls.flat().sort()).toEqual(["one", "three", "two"]);
});

it("resumes the same prepared capture only after explicit missing-object confirmation", async () => {
  record = { ...record, status: "uploading", prepared: new Blob(["prepared"]), allocation: { key: receipt.key, uploadId: "upload" } }; saved = record;
  fetcher.mockResolvedValueOnce(Response.json({ code: "EVIDENCE_OBJECT_MISSING", error: "Video is incomplete" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ ok: true, captureId: record.id, key: receipt.key, media: receipt }));
  const upload = vi.fn(async (current, beforeNetwork) => {
    expect(current.allocation).toEqual(record.allocation); expect(current.prepared).toBe(record.prepared);
    await beforeNetwork(); return receipt;
  });
  await expect(processEvidence(record, scope, upload)).resolves.toEqual({ ...receipt, name: record.filename });
  expect(upload).toHaveBeenCalledOnce(); expect(saved.status).toBe("attached");
});
it("never resends bytes after an authorization or uncertain attachment failure", async () => {
  record = { ...record, status: "uploading", prepared: new Blob(["prepared"]), allocation: { key: receipt.key, uploadId: "upload" } }; saved = record;
  fetcher.mockResolvedValueOnce(Response.json({ error: "Not assigned" }, { status: 403 }));
  const upload = vi.fn();
  await expect(processEvidence(record, scope, upload)).rejects.toThrow("Not assigned"); expect(upload).not.toHaveBeenCalled();
});


it("releases a stalled attachment and retries its saved receipt without uploading bytes again", async () => {
  vi.useFakeTimers();
  try {
    const upload = vi.fn(async () => receipt);
    fetcher.mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const result = processEvidence(record, scope, upload);
    const assertion = expect(result).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;
    expect(saved.status).toBe("uploaded");
    expect(saved.receipt).toEqual(receipt);
    expect(saved.blob).toBe(record.blob);
    await processEvidence(saved, scope, upload);
    expect(upload).toHaveBeenCalledOnce();
    expect(saved.status).toBe("attached");
  } finally { vi.useRealTimers(); }
});

describe("capture cancellation scope and storage boundaries", () => {
  it("rejects a cancellation from another job before reading or writing", async () => {
    await expect(cancelPendingEvidence(record, { ...scope, jobId: "other" })).rejects.toThrow("context changed");
    expect(store.get).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires browser coordination for capture removal and submission", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(cancelPendingEvidence(record, scope)).rejects.toThrow("coordinate");
    await expect(removeEvidence(scope, receipt.key)).rejects.toThrow("coordinate");
    await expect(withEvidenceSubmissionLock(scope, vi.fn())).rejects.toThrow("coordinate");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["missing", "foreign"])("retains originals when the cancellation record is %s after the lock", async state => {
    store.get.mockResolvedValue(state === "missing" ? undefined : { ...record, draftIdentity: "other" });
    await expect(cancelPendingEvidence(record, scope)).rejects.toThrow("recovery context changed");
    expect(store.put).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels an allocated upload without a completion receipt and keeps its original bytes", async () => {
    saved = { ...record, allocation: { key: receipt.key, uploadId: "unfinished" }, status: "uploading" };
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: record.id, detached: true }));
    expect(await cancelPendingEvidence(saved, scope)).toBe(receipt.key);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ key: receipt.key, cancelPending: true });
    expect(saved.status).toBe("detached");
    expect(saved.blob).toBe(record.blob);
    expect(saved.allocation?.uploadId).toBe("unfinished");
  });
});

describe("acknowledged removal preserves data and current scope", () => {
  const key = "forms/job/capture/cleaner/photo.jpg";

  it("persists a successful removal tombstone without changing the retained original", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, key }));
    await removeEvidence(scope, key);
    expect(store.get).toHaveBeenCalledWith("capture");
    expect(saved.status).toBe("detached");
    expect(saved.blob).toBe(record.blob);
  });

  it("requires explicit discarded-reference acknowledgement when sending a reason", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, key }));
    await expect(removeEvidence(scope, key, "Wrong job reference")).rejects.toThrow("not confirmed");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ discardReference: true, reason: "Wrong job reference" });
    expect(store.put).not.toHaveBeenCalled();
  });

  it("keeps explicit server guidance for an out-of-context reference", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ error: "Office review", code: "EVIDENCE_CONTEXT_MISMATCH", canDiscardReference: true }, { status: 409 }));
    await expect(removeEvidence(scope, key)).rejects.toMatchObject({ message: "Office review", key, canDiscardReference: true });
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([undefined, { draftIdentity: "other" }])("does not modify a missing or foreign local record after server removal", async local => {
    store.get.mockResolvedValue(local ? { ...record, ...local } : undefined);
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, key }));
    await removeEvidence(scope, key);
    expect(store.put).not.toHaveBeenCalled();
  });

  it("acknowledges an explicitly discarded legacy reference without inventing a local capture", async () => {
    store.get.mockResolvedValue(undefined);
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, key: "legacy.jpg", discardedReference: true }));
    await removeEvidence(scope, "legacy.jpg", "Belongs to a different job");
    expect(store.get).toHaveBeenCalledWith("legacy.jpg");
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe("move recovery validates server snapshots and acknowledgements", () => {
  const from = { type: "bulkPool" as const };
  const to = { type: "formField" as const, fieldId: "proof" };
  const ownedMedia = { ...receipt, key: "forms/job/capture/cleaner/photo.jpg", name: "Retain this name" };
  const snapshot = (overrides: Record<string, unknown> = {}) => ({ evidenceReceipts: { capture: {
    key: ownedMedia.key, fieldId: "bulkPool", destination: from, draftIdentity: scope.draftIdentity,
    formRevision: scope.formRevision, ...overrides,
  } } } as any);

  it.each([{ error: "Not assigned" }, {}])("stops on a failed snapshot read without issuing a move", async body => {
    fetcher.mockResolvedValueOnce(Response.json(body, { status: 403 }));
    await expect(moveEvidence(scope, ownedMedia, from, to)).rejects.toThrow(body.error || "could not be checked");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([{}, { draft: null }])("leaves receipt-less legacy media list-managed", async body => {
    fetcher.mockResolvedValueOnce(Response.json(body));
    await moveEvidence(scope, receipt, from, to);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([
    { detached: true }, { draftIdentity: "other" }, { destination: { type: "formField", fieldId: "different" } },
  ])("rejects a removed, foreign or concurrently moved receipt", async overrides => {
    await expect(moveEvidence(scope, ownedMedia, from, to, undefined, snapshot(overrides))).rejects.toThrow("belongs to another cleaner");
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("requires a browser lock even when the server snapshot is otherwise valid", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(moveEvidence(scope, ownedMedia, from, to, undefined, snapshot())).rejects.toThrow("coordinate");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts an unversioned receipt as version zero and verifies the acknowledged move", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: "capture", key: ownedMedia.key, version: 1, destination: to }));
    await moveEvidence(scope, ownedMedia, from, to, { captureId: "capture", version: 0 }, snapshot());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ move: { from, version: 0 }, name: ownedMedia.name });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("legacy");
    expect(saved).toMatchObject({ destination: to, fieldId: "proof", destinationVersion: 1 });
  });

  it.each([undefined, { draftIdentity: "other" }])("does not create or overwrite a local record for an already committed move", async local => {
    store.get.mockResolvedValue(local ? { ...record, ...local } : undefined);
    await moveEvidence(scope, ownedMedia, to, from, undefined, snapshot());
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("repairs the local bulk-pool destination after a lost move acknowledgement", async () => {
    await moveEvidence(scope, ownedMedia, to, from, undefined, snapshot());
    expect(saved).toMatchObject({ destination: from, fieldId: JSON.stringify(["bulkPool"]), destinationVersion: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([{ error: "Receipt revoked" }, {}])("retains the current destination after a rejected move", async body => {
    fetcher.mockResolvedValueOnce(Response.json(body, { status: 409 }));
    await expect(moveEvidence(scope, ownedMedia, from, to, undefined, snapshot())).rejects.toThrow(body.error || "not confirmed");
    expect(saved.destination).toBeUndefined();
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([
    { key: "other/key" }, { version: 4 }, { destination: undefined }, { destination: from },
  ])("does not project a partial or conflicting move acknowledgement", async invalid => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: "capture", key: ownedMedia.key, version: 1, destination: to, ...invalid }));
    await expect(moveEvidence(scope, ownedMedia, from, to, undefined, snapshot())).rejects.toThrow("acknowledgement did not match");
    expect(store.put).not.toHaveBeenCalled();
  });

  it("persists a confirmed move into the bulk pool", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: "capture", key: ownedMedia.key, version: 1, destination: from }));
    await moveEvidence(scope, ownedMedia, to, from, undefined, snapshot({ destination: to, fieldId: "proof" }));
    expect(saved).toMatchObject({ destination: from, fieldId: JSON.stringify(["bulkPool"]), destinationVersion: 1 });
  });

  it("does not overwrite another local scope when the move finishes", async () => {
    store.get.mockResolvedValue({ ...record, draftIdentity: "other" });
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: "capture", key: ownedMedia.key, version: 1, destination: to }));
    await moveEvidence(scope, ownedMedia, from, to, undefined, snapshot());
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each([{ error: "No access" }, {}])("does not start a batch when its shared snapshot read fails", async body => {
    fetcher.mockResolvedValueOnce(Response.json(body, { status: 403 }));
    const onMoved = vi.fn();
    await expect(moveEvidenceBatch(scope, [{ media: receipt, from }], to, onMoved, () => true)).rejects.toThrow(body.error || "could not be checked");
    expect(onMoved).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not issue moves for an empty draft without acknowledged receipts", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ draft: null }));
    const onMoved = vi.fn();
    await moveEvidenceBatch(scope, [{ media: receipt, from }], to, onMoved, () => true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onMoved).toHaveBeenCalledWith(receipt.key);
  });

  it("reports a failed batch member and keeps successfully confirmed moves", async () => {
    const other = { ...ownedMedia, key: "forms/job/other/cleaner/photo.jpg" };
    fetcher.mockResolvedValueOnce(Response.json({ draft: { evidenceReceipts: {
      ...snapshot().evidenceReceipts, other: { ...snapshot().evidenceReceipts.capture, key: other.key },
    } } }));
    fetcher.mockImplementation(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.captureId === "other") throw "connection reset";
      return Response.json({ ok: true, captureId: "capture", key: ownedMedia.key, version: 1, destination: to });
    });
    const onMoved = vi.fn();
    await expect(moveEvidenceBatch(scope, [{ media: ownedMedia, from }, { media: other, from }], to, onMoved, () => true)).rejects.toThrow("1 photo(s) need attention. Assignment was not confirmed");
    expect(onMoved).toHaveBeenCalledOnce();
    expect(onMoved).toHaveBeenCalledWith(ownedMedia.key);
  });
});

describe("attachment acknowledgement boundaries", () => {
  it("does not contact the server without an allocated key or receipt", async () => {
    await expect(attachEvidence(record)).rejects.toThrow("receipt is missing");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a safe fallback on a non-JSON attachment rejection", async () => {
    fetcher.mockResolvedValueOnce(new Response("gateway unavailable", { status: 503 }));
    await expect(attachEvidence({ ...record, receipt })).rejects.toThrow("not confirmed");
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each(["//untrusted.invalid/image", "javascript:alert(1)"])("rejects an unsafe canonical media URL %s", async url => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: record.id, key: receipt.key, media: { ...receipt, url } }));
    await expect(attachEvidence({ ...record, receipt })).rejects.toThrow("invalid receipt");
  });

  it("uses a verified relative media URL for allocation-only recovery", async () => {
    fetcher.mockResolvedValueOnce(Response.json({ ok: true, captureId: record.id, key: receipt.key, media: { ...receipt, url: "/media/image" } }));
    expect(await attachEvidence({ ...record, allocation: { key: receipt.key, uploadId: "upload" } })).toMatchObject({ url: "/media/image", key: receipt.key, name: record.filename });
  });

  it("retains allocation-only evidence when a matching acknowledgement lacks verified media", async () => {
    await expect(attachEvidence({ ...record, allocation: { key: receipt.key, uploadId: "upload" } })).rejects.toThrow("did not return its verified media receipt");
  });
});

describe("processing races retain known bytes and reject contradictory receipts", () => {
  it.each([undefined, { draftIdentity: "other" }])("rejects a missing or rebound capture after waiting for its lock", async local => {
    store.get.mockResolvedValue(local ? { ...record, ...local } : undefined);
    const upload = vi.fn();
    await expect(processEvidence(record, scope, upload)).rejects.toThrow("recovery context changed");
    expect(upload).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reuses an already attached receipt without a network request", async () => {
    saved = { ...record, status: "attached", receipt };
    const upload = vi.fn();
    expect(await processEvidence(record, scope, upload)).toEqual(receipt);
    expect(upload).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses an upload response for a different allocated object", async () => {
    saved = { ...record, allocation: { key: "forms/job/capture/cleaner/exact.jpg", uploadId: "upload" } };
    await expect(processEvidence(record, scope, async () => receipt)).rejects.toThrow("did not match its allocated key");
    expect(saved.receipt).toBeUndefined();
    expect(saved.blob).toBe(record.blob);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retains the capture when journal reads fail during a rejected upload", async () => {
    store.get.mockResolvedValueOnce(record).mockRejectedValueOnce(new Error("device read failed"));
    await expect(processEvidence(record, scope, async () => { throw "network unavailable"; })).rejects.toBe("network unavailable");
    expect(saved.error).toBe("Evidence could not be saved.");
    expect(saved.blob).toBe(record.blob);
  });

  it("keeps the in-flight snapshot if a local lookup disappears before network or receipt persistence", async () => {
    store.get.mockResolvedValueOnce(record).mockResolvedValue(undefined);
    const upload = vi.fn(async (_current, beforeNetwork) => { await beforeNetwork(); return receipt; });
    await expect(processEvidence(record, scope, upload)).resolves.toEqual(receipt);
    expect(upload).toHaveBeenCalledOnce();
    expect(saved).toMatchObject({ receipt, status: "attached" });
    expect(saved.blob).toBe(record.blob);
  });
});
