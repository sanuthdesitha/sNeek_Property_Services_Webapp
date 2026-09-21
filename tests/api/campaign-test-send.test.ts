import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), campaign: vi.fn(), recipients: vi.fn(), client: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => ({ db: { emailCampaign: { findUnique: m.campaign }, client: { findUnique: m.client } } }));
vi.mock("@/lib/marketing/email-campaigns", () => ({ resolveEmailCampaignRecipients: m.recipients }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountsEmail: "office@example.invalid" }) }));
import { POST } from "@/app/api/admin/email-campaigns/[id]/test-send/route";
const request = () => POST(new Request("http://localhost/test", { method: "POST" }), { params: { id: "campaign" } });
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { email: "admin@example.invalid" } });
  m.campaign.mockResolvedValue({ subject: "Hello {{client.firstName}}", htmlBody: "<p>{{client.name}}</p>", audience: { type: "single_recipient", filters: { email: "alice@example.invalid" } } });
  m.recipients.mockResolvedValue({ recipients: [{ clientId: "client", clientName: "Alice & Co", email: "alice@example.invalid" }] });
  m.client.mockResolvedValue({ id: "client", name: "Alice & Co" });
  m.email.mockResolvedValue({ ok: true });
});
it("renders the real selected client while sending exactly one test exclusively to the admin", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ to: "admin@example.invalid", previewClientName: "Alice & Co" });
  expect(m.recipients).toHaveBeenCalledWith({ type: "single_recipient", filters: { email: "alice@example.invalid" } });
  expect(m.email).toHaveBeenCalledOnce();
  expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@example.invalid", subject: "[TEST] Hello Alice", html: "<p>Alice &amp; Co</p>", transactional: true }));
});
it("does not send unresolved variables when no selected client is eligible", async () => {
  m.recipients.mockResolvedValue({ recipients: [] });
  const response = await request();
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("No eligible client");
  expect(m.email).not.toHaveBeenCalled();
});
it("allows a test without variables when the audience has no client", async () => {
  m.campaign.mockResolvedValue({ subject: "News", htmlBody: "<p>Service update</p>", audience: { type: "all_clients" } });
  m.recipients.mockResolvedValue({ recipients: [] });
  expect((await request()).status).toBe(200);
  expect(m.email).toHaveBeenCalledOnce();
});
it("rejects unknown variables before the test provider is called", async () => {
  m.campaign.mockResolvedValue({ subject: "{{client.fristName}}", htmlBody: "Hi", audience: { type: "all_clients" } });
  expect((await request()).status).toBe(400);
  expect(m.email).not.toHaveBeenCalled();
});
it("keeps authorization enforced before reading campaign recipients", async () => {
  m.session.mockRejectedValue(new Error("FORBIDDEN"));
  expect((await request()).status).toBe(403);
  expect(m.recipients).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled();
});
