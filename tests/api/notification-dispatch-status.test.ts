// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/admin/notifications/dispatch-status/route";
const m = vi.hoisted(() => ({ role: vi.fn(), mobile: vi.fn(), receipts: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { notification: { findMany: m.mobile }, appSetting: { findMany: m.receipts } } }));
beforeEach(() => { vi.clearAllMocks(); m.role.mockResolvedValue({ user: { role: "ADMIN" } }); m.mobile.mockResolvedValue([]); m.receipts.mockResolvedValue([]); });
it("requires an administrator and performs only reads", async () => {
  const response = await GET(); expect(response.status).toBe(200);
  expect(m.role).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it("does not read notification data if authorization fails", async () => {
  m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
  expect((await GET()).status).toBe(403); expect(m.mobile).not.toHaveBeenCalled(); expect(m.receipts).not.toHaveBeenCalled();
});
it("flags stranded dispatch claims without exposing recipient data", async () => {
  m.receipts.mockResolvedValue([{ key: "receipt", value: { event: "cleaner.day_reminder", status: "PROCESSING", startedAt: "2020-01-01", recipientId: "private-id" } }]);
  const response = await GET(); const data = await response.json();
  expect(data.attempts[0].needsReview).toBe(true); expect(data.attempts[0]).not.toHaveProperty("recipientId");
});
