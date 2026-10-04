// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const readStates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db: { propertyRotationState: { findMany: readStates } } }));
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { applyJobRotationCompletion, deriveRotationalCompletion, getRotationDueMap, isRotationalItemDue } from "@/lib/accountability/rotation";
const field = { id: "detail", frequency: "ROTATIONAL", type: "photo" };
let tx: any;
beforeEach(() => { tx = { $queryRaw: vi.fn(), appSetting: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, job: { findUnique: vi.fn().mockResolvedValue({ status: "COMPLETED", isRework: false }) }, formSubmission: { findFirst: vi.fn().mockResolvedValue({ data: { __rotationSections: [{ fields: [field] }], __templateSchema: { sections: [{ fields: [] }] }, uploads: {} } }) }, propertyRotationState: { upsert: vi.fn() } }; });
it("advances absent non-due item once at QA completion, retaining durable receipt", async () => {
  await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" });
  expect(tx.propertyRotationState.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { cleansSinceDone: { increment: 1 } } }));
  expect(tx.appSetting.create).toHaveBeenCalled();
  tx.appSetting.findUnique.mockResolvedValue({ key: "rotation_progress_v1:j" });
  await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" });
  expect(tx.propertyRotationState.upsert).toHaveBeenCalledTimes(1);
});
it.each([{ status: "SUBMITTED", isRework: false }, { status: "COMPLETED", isRework: true }, { status: "COMPLETED", isRework: false, internalNotes: serializeJobInternalNotes({ isDraft: true }) }])("does not count submission/rework %j", async job => {
  tx.job.findUnique.mockResolvedValue(job); await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" });
  expect(tx.propertyRotationState.upsert).not.toHaveBeenCalled();
});
it("resets only evidenced visible rotational work", async () => {
  tx.formSubmission.findFirst.mockResolvedValue({ data: { __rotationSections: [{ fields: [field] }], __templateSchema: { sections: [{ fields: [field] }] }, uploads: { detail: ["proof.jpg"] } } });
  await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" });
  expect(tx.propertyRotationState.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ cleansSinceDone: 0, lastCompletedJobId: "j" }) }));
});
it("reads due states once, handles unseen items and invalid counts/cadences", async () => {
 readStates.mockResolvedValue([{ itemKey: "ready", cleansSinceDone: 3 }, { itemKey: "early", cleansSinceDone: 0 }]);
 expect(await getRotationDueMap("p", [])).toEqual({});
 expect(await getRotationDueMap("p", [{ key: "ready", rotationEveryNCleans: 4 }, { key: "early", rotationEveryNCleans: 3 }, { key: "new", rotationEveryNCleans: 4 }, { key: "off", rotationEveryNCleans: null }])).toEqual({ ready: true, early: false, new: true, off: false });
 expect(readStates).toHaveBeenCalledTimes(1);
 expect(isRotationalItemDue({ cleansSinceDone: NaN }, 4)).toBe(true);
 expect(isRotationalItemDue(null, Infinity)).toBe(false);
});
it("derives nested rotational answers across supported field types and malformed historical sections", () => {
 const fields = ["photo", "check", "text", "array", "number", "empty", "false"].map(id => ({ id: `${id}__bed1`, frequency: "ROTATIONAL" }));
 const result = deriveRotationalCompletion([null, {}, { fields: [null, "bad", { children: fields }] }], { check__bed1: true, text__bed1: "done", array__bed1: ["answer"], number__bed1: 0, empty__bed1: " ", false__bed1: false }, { photo__bed1: ["proof"] });
 expect(result.completedItemKeys).toEqual(["photo", "check", "text", "array", "number"]);
 expect(result.allRotationalItemKeys).toHaveLength(7);
 expect(deriveRotationalCompletion(null, {}, {})).toEqual({ completedItemKeys: [], allRotationalItemKeys: [] });
});
it.each([null, { data: null }, { data: {} }])("does not consume a completion receipt without a usable rotational snapshot %j", async submission => {
 tx.formSubmission.findFirst.mockResolvedValue(submission);
 await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" });
 expect(tx.appSetting.create).not.toHaveBeenCalled(); expect(tx.propertyRotationState.upsert).not.toHaveBeenCalled();
});
it("missing job does not advance any state", async () => {
 tx.job.findUnique.mockResolvedValue(null); await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" }); expect(tx.formSubmission.findFirst).not.toHaveBeenCalled();
});
it("supports invoiced legacy snapshots, string uploads and filters invalid array keys", async () => {
 tx.job.findUnique.mockResolvedValue({ status: "INVOICED", isRework: false });
 tx.formSubmission.findFirst.mockResolvedValue({ data: { __templateSchema: { sections: [{ fields: [field, { ...field, id: "second" }, { ...field, id: "third" }] }] }, uploads: { detail: "proof", second: [null, 42, " ", "valid"], third: false } } });
 await applyJobRotationCompletion(tx, { jobId: "j", propertyId: "p" });
 expect(tx.propertyRotationState.upsert).toHaveBeenCalledTimes(3);
 expect(tx.propertyRotationState.upsert.mock.calls[2][0].update).toEqual({ cleansSinceDone: { increment: 1 } });
});
