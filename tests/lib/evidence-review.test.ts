import { describe, expect, it } from "vitest";
import { canCleanerDiscardReference, discardDraftReference, evidenceReviewRows, belongsToAnotherJob } from "@/lib/cleaner/evidence-review";
import { reconcileEvidenceState, evidenceSubmissionChanged } from "@/lib/cleaner/evidence-destination";
const key = "forms/other-job/capture/cleaner/photo.jpg";
const media = { key, kind: "image", url: "/original.jpg", name: "Original photo" };
const receipt = { key, fieldId: "bulkPool", destination: { type: "bulkPool" as const }, draftIdentity: "original-context", formRevision: "original-version", version: 3 };
function draft() { return { updatedAt: "2020-01-01", updatedByUserId: "cleaner", updatedByName: "Cleaner", editorSessionId: "old", state: { bulkPool: [media], answers: { keep: true } }, evidenceReceipts: { capture: receipt } }; }
const input = { key, actorId: "office", actorName: "Office", reason: "Photo belongs to a different job", at: "2026-10-07T00:00:00Z", receiptId: "removal-marker", formRevision: "current", draftIdentity: "current-context", office: true };
describe("discarding draft references without adopting or deleting originals", () => {
  it("preserves original receipt provenance, captures an explicit resolution and prevents resurrection", () => {
    const original = draft(); const next = discardDraftReference(original, input);
    expect(next.state.bulkPool).toEqual([]); expect(next.state.answers).toEqual({ keep: true });
    expect(next.evidenceReceipts.capture).toMatchObject({ ...receipt, detached: true, resolution: { action: "DISCARD_DRAFT_REFERENCE", actorId: "office", reason: input.reason } });
    expect(original.evidenceReceipts.capture).toEqual(receipt); expect(original.state.bulkPool).toEqual([media]);
    expect(reconcileEvidenceState(original.state, next.state, next.evidenceReceipts).bulkPool).toEqual([]);
    expect(evidenceSubmissionChanged(next.evidenceReceipts, {}, [], {})).toBe(false);
    expect(evidenceSubmissionChanged(next.evidenceReceipts, { proof: [key] }, [], {})).toBe(true);
  });
  it("allows a wrong-job reference, including local-only recovery, but blocks valid same-job co-cleaner proof", () => {
    expect(canCleanerDiscardReference(draft(), key, "job", "cleaner")).toBe(true);
    expect(canCleanerDiscardReference(null, key, "job", "cleaner")).toBe(true);
    const sameJobKey = "forms/job/capture/colleague/photo.jpg";
    expect(canCleanerDiscardReference({ ...draft(), evidenceReceipts: {}, state: { bulkPool: [{ ...media, key: sameJobKey }] } }, sameJobKey, "job", "cleaner")).toBe(false);
    expect(canCleanerDiscardReference({ ...draft(), state: { uploads: { proof: [media] } } }, key, "job", "cleaner")).toBe(false);
  });
  it("allows own historical unassigned context, never guesses ownership for unknown keys", () => {
    const old = "forms/cleaner/old.jpg";
    expect(canCleanerDiscardReference({ ...draft(), evidenceReceipts: {}, state: { bulkPool: [{ ...media, key: old }] } }, old, "job", "cleaner")).toBe(true);
    expect(canCleanerDiscardReference(null, "unrecognised/file.jpg", "job", "cleaner")).toBe(false);
  });
  it.each(["forms/job/capture/user/a.jpg", "jobs/job/user/a.jpg", "forms/user/a.jpg", "https://bad.invalid/a.jpg", "forms/../capture/user/a.jpg"])("does not misclassify same-job, legacy or unsafe layout %s", value => expect(belongsToAnotherJob(value, "job")).toBe(false));
  it("reports original foreign-job provenance and capture context separately", () => {
    const row = evidenceReviewRows(draft(), "job")[0];
    expect(row.source).toMatchObject({ jobId: "other-job", userId: "cleaner", captureId: "capture" }); expect(row.issues).toContain("Stored under another job");
  });
});
