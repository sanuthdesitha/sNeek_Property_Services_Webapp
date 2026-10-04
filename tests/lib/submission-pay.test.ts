// @vitest-environment node
import { expect, it, vi } from "vitest";
import { persistSubmissionPayRequestOnce } from "@/lib/cleaner/submission-pay";
const input = { jobId: "job", propertyId: "property", cleanerId: "cleaner", request: { title: "Oven", requestedAmount: 20, cleanerNote: "Detail" } };
it("keeps an existing financial decision without recreating it on resubmission", async () => {
  const tx = { cleanerPayAdjustment: { findFirst: vi.fn().mockResolvedValue({ id: "original-paid-or-rejected" }), create: vi.fn() } };
  expect(await persistSubmissionPayRequestOnce(tx as any, input)).toBe(false);
  expect(tx.cleanerPayAdjustment.create).not.toHaveBeenCalled();
  expect(tx.cleanerPayAdjustment.findFirst.mock.calls[0][0].where.OR[1]).toMatchObject({ source: null, requestedAmount: 20, title: "Oven" });
});
it("creates a stable source key for genuinely new requests and preserves reimbursement tax category", async () => {
  const tx = { cleanerPayAdjustment: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };
  expect(await persistSubmissionPayRequestOnce(tx as any, { ...input, request: { ...input.request, category: "REIMBURSEMENT" } })).toBe(true);
  expect(tx.cleanerPayAdjustment.create.mock.calls[0][0].data).toMatchObject({ source: "CLEANER_SUBMISSION", sourceKey: expect.stringMatching(/^[a-f0-9]{64}$/), taxable: false });
});
it("normalizes hourly evidence requests and maintains identity across whitespace changes", async () => {
  const tx = { cleanerPayAdjustment: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };
  const request = { title: "  Extra hour  ", type: "HOURLY" as const, requestedHours: 1, requestedRate: 30, requestedAmount: 30, mediaKeys: ["proof"] };
  await persistSubmissionPayRequestOnce(tx as any, { ...input, request });
  const first = tx.cleanerPayAdjustment.create.mock.calls[0][0].data;
  expect(first).toMatchObject({ title: "Extra hour", type: "HOURLY", requestedHours: 1, requestedRate: 30, cleanerNote: "Extra hour", category: "SERVICE", attachmentKeys: ["proof"], taxable: true });
  await persistSubmissionPayRequestOnce(tx as any, { ...input, request: { ...request, title: "Extra hour" } });
  expect(tx.cleanerPayAdjustment.create.mock.calls[1][0].data.sourceKey).toBe(first.sourceKey);
});
it("uses a default title without inventing a note or attachments", async () => {
  const tx = { cleanerPayAdjustment: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() } };
  await persistSubmissionPayRequestOnce(tx as any, { ...input, request: { requestedAmount: 5, mediaKeys: [] } });
  expect(tx.cleanerPayAdjustment.create.mock.calls[0][0].data).toMatchObject({ title: "Extra payment request", cleanerNote: null, type: "FIXED", requestedHours: null, requestedRate: null, attachmentKeys: undefined });
});
