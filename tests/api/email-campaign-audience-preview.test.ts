import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/email-campaigns/audience-preview/route";
import { requireRole } from "@/lib/auth/session";
import { resolveEmailCampaignRecipients } from "@/lib/marketing/email-campaigns";
vi.mock("@/lib/auth/session", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/marketing/email-campaigns", () => ({ resolveEmailCampaignRecipients: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireRole).mockResolvedValue({ user: { id: "admin" } } as any); });
const request = (audience: unknown) => new Request("http://localhost/api/admin/email-campaigns/audience-preview", { method: "POST", body: JSON.stringify({ audience }) });
it("normalizes the selection and returns private matching recipients without phone data", async () => {
  const audience = { type: "single_recipient", filters: { email: "client@example.com" } };
  vi.mocked(resolveEmailCampaignRecipients).mockResolvedValue({ audience, count: 1, recipients: [{ clientId: "c1", clientName: "Client", email: "client@example.com", phone: "123" }] } as any);
  const response = await POST(request({ ...audience, filters: { email: " Client@Example.com " } }));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ audience, count: 1, recipients: [{ clientId: "c1", clientName: "Client", email: "client@example.com" }] });
  expect(resolveEmailCampaignRecipients).toHaveBeenCalledWith(audience);
  expect(requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});
it("rejects a missing single email before resolution", async () => {
  expect((await POST(request({ type: "single_recipient" }))).status).toBe(400);
  expect(resolveEmailCampaignRecipients).not.toHaveBeenCalled();
});
it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("blocks %s", async (message, status) => {
  vi.mocked(requireRole).mockRejectedValue(new Error(message as string));
  expect((await POST(request({ type: "all_clients" }))).status).toBe(status);
  expect(resolveEmailCampaignRecipients).not.toHaveBeenCalled();
});
