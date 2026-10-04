import { expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireRole: auth }));
vi.mock("@/components/v2/admin/properties/property-deep-clean-planning", () => ({ DeepCleanProposalQueue: () => null }));
import Page from "@/app/v2/admin/deep-clean-planning/page";
import { DeepCleanProposalQueue } from "@/components/v2/admin/properties/property-deep-clean-planning";
it("requires an office role before rendering the scheduling queue", async () => {
  auth.mockResolvedValue({ user: { role: "ADMIN" } });
  expect((await Page()).type).toBe(DeepCleanProposalQueue);
  expect(auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});
it("does not render the queue when authorization fails", async () => {
  auth.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(Page()).rejects.toThrow("FORBIDDEN");
});
