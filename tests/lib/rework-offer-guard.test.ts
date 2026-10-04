import { expect, it, vi } from "vitest";
import { hasUnacceptedOriginalReworkOffer } from "@/lib/cleaner/rework-offer-guard";
it.each(["OFFERED", "DECLINED", "EXPIRED"])("blocks original cleaner with %s offer", async status => {
  const tx = { jobAssignment: { findFirst: vi.fn().mockResolvedValue({ userId: "original" }) }, qaAssignment: { findFirst: vi.fn().mockResolvedValue({ reworkOfferStatus: status }) } };
  expect(await hasUnacceptedOriginalReworkOffer(tx as any, { reworkOfJobId: "parent" }, "original")).toBe(true);
});
it.each(["ACCEPTED", "NONE", null])("allows original cleaner with %s offer", async status => {
  const tx = { jobAssignment: { findFirst: vi.fn().mockResolvedValue({ userId: "original" }) }, qaAssignment: { findFirst: vi.fn().mockResolvedValue({ reworkOfferStatus: status }) } };
  expect(await hasUnacceptedOriginalReworkOffer(tx as any, { reworkOfJobId: "parent" }, "original")).toBe(false);
});
it("does not block a reassigned cleaner", async () => {
  const tx = { jobAssignment: { findFirst: vi.fn().mockResolvedValue({ userId: "original" }) }, qaAssignment: { findFirst: vi.fn() } };
  expect(await hasUnacceptedOriginalReworkOffer(tx as any, { reworkOfJobId: "parent" }, "new-cleaner")).toBe(false);
  expect(tx.qaAssignment.findFirst).not.toHaveBeenCalled();
});
