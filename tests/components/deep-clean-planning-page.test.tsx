import { Suspense, type ReactElement } from "react";
import { expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/session", () => ({ requireRole: auth }));
// Deep-clean scheduling was rebuilt (2026-11-16): the page renders
// DeepCleanScheduling inside a Suspense boundary (it reads ?property= and
// ?verify= with useSearchParams) instead of DeepCleanProposalQueue.
vi.mock("@/components/v2/admin/properties/deep-clean-scheduling", () => ({ DeepCleanScheduling: () => null }));
import Page from "@/app/v2/admin/deep-clean-planning/page";
import { DeepCleanScheduling } from "@/components/v2/admin/properties/deep-clean-scheduling";
it("requires an office role before rendering the scheduling queue", async () => {
  auth.mockResolvedValue({ user: { role: "ADMIN" } });
  const page = (await Page()) as ReactElement<{ children: ReactElement }>;
  expect(page.type).toBe(Suspense);
  expect(page.props.children.type).toBe(DeepCleanScheduling);
  expect(auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});
it("does not render the queue when authorization fails", async () => {
  auth.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(Page()).rejects.toThrow("FORBIDDEN");
});
