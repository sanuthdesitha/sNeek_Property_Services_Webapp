import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { emailCampaign: { update: m.update } } }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => ({ user: { id: "admin" } }) }));
import { PATCH } from "@/app/api/admin/email-campaigns/[id]/route";
beforeEach(() => { vi.clearAllMocks(); m.update.mockResolvedValue({ id: "campaign" }); });
function patch(email: string) { return PATCH(new NextRequest("http://localhost/campaign", { method: "PATCH", body: JSON.stringify({ channel: "EMAIL", campaignStatus: "SCHEDULED", audience: { type: "single_recipient", filters: { email } } }) }), { params: { id: "campaign" } }); }
it("persists the selected audience atomically with a marketing schedule patch", async () => {
  expect((await patch("SECONDARY@example.invalid")).status).toBe(200);
  expect(m.update).toHaveBeenCalledWith({ where: { id: "campaign" }, data: { channel: "EMAIL", campaignStatus: "SCHEDULED", audience: { type: "single_recipient", filters: { email: "secondary@example.invalid" } } } });
});
it("rejects invalid single-recipient audiences without silently scheduling the previous broadcast", async () => {
  expect((await patch("invalid")).status).toBe(400);
  expect(m.update).not.toHaveBeenCalled();
});
