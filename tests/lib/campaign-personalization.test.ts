import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ campaign: vi.fn(), clients: vi.fn(), client: vi.fn(), claim: vi.fn(), email: vi.fn(), sms: vi.fn(), update: vi.fn(), suppressed: vi.fn(), due: vi.fn(), claimCampaign: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  emailCampaign: { findUnique: m.campaign, update: m.update, findMany: m.due, updateMany: m.claimCampaign },
  client: { findMany: m.clients, findUnique: m.client },
  campaignSend: { create: m.claim, updateMany: vi.fn(async () => ({})), deleteMany: vi.fn(async () => ({})) },
} }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/email/suppression", () => ({ isSuppressed: m.suppressed }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountsEmail: "office@example.invalid" }) }));
vi.mock("@/lib/marketing/segments", () => ({ isSegmentId: () => false, resolveSegment: vi.fn() }));
import { renderCampaignContent } from "@/lib/marketing/campaign-render";
import { dispatchEmailCampaignById, dispatchScheduledEmailCampaigns } from "@/lib/marketing/email-campaigns";
import { sendCampaign } from "@/lib/marketing/campaign-sender";
import { CAMPAIGN_TEMPLATES, templateToDesign } from "@/lib/marketing/campaign-templates";
import { renderEmailHtml } from "@/lib/templates/email-blocks";
const recipient = { id: "client-1", name: "Alice Smith", email: "alice@example.invalid", phone: "0400000000", suburb: null, users: [], properties: [], invoices: [] };
beforeEach(() => {
  vi.clearAllMocks();
  m.campaign.mockResolvedValue({ id: "campaign", subject: "Hi {{client.firstName}}", htmlBody: "<p>Hello {{client.firstName}} {{client.lastName}}</p>", audience: { type: "all_clients" }, channel: "EMAIL", template: null });
  m.clients.mockResolvedValue([recipient]); m.client.mockResolvedValue(recipient);
  m.claim.mockResolvedValue({ id: "claim" }); m.email.mockResolvedValue({ ok: true }); m.sms.mockResolvedValue({ ok: true }); m.update.mockResolvedValue({});
  m.suppressed.mockResolvedValue(false);
  m.due.mockResolvedValue([]); m.claimCampaign.mockResolvedValue({ count: 1 });
});
describe("campaign recipient personalization", () => {
  it("marks a rejected legacy schedule failed and continues to the next campaign without claiming the bad recipient", async () => {
    m.due.mockResolvedValue([{ id: "bad" }, { id: "good" }]);
    m.campaign.mockImplementation(async ({ where }) => ({ id: where.id, subject: "Hello", htmlBody: where.id === "bad" ? "{{client.typo}}" : "Hi {{client.firstName}}", audience: { type: "all_clients" } }));
    expect(await dispatchScheduledEmailCampaigns()).toMatchObject({ campaigns: 2, dispatched: 1, failed: 1 });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "bad" }, data: { status: "failed", sentAt: null } });
    expect(m.claim).toHaveBeenCalledOnce(); expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ campaignId: "good" }) }));
    expect(m.email).toHaveBeenCalledOnce();
  });
  it.each(["legacy", "multi-channel"])("reports a provider refusal as failed instead of sent in %s", async path => {
    m.email.mockResolvedValue({ ok: false, error: "Rejected" });
    if (path === "legacy") expect(await dispatchEmailCampaignById("campaign")).toMatchObject({ failed: 1, sent: 0 });
    else expect(await sendCampaign("campaign")).toMatchObject({ failed: 1, sent: 0 });
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", sentAt: null }) }));
  });
  it("does not send SMS to the account owner when the selected secondary contact has no phone", async () => {
    m.campaign.mockResolvedValue({ id: "campaign", subject: "Hi", htmlBody: "Hello", audience: { type: "single_recipient", filters: { email: "secondary@example.invalid" } }, channel: "BOTH" });
    m.clients.mockResolvedValue([{ ...recipient, phone: "0411111111", users: [{ phone: null }] }]);
    await sendCampaign("campaign");
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "secondary@example.invalid" }));
    expect(m.sms).not.toHaveBeenCalled();
  });
  it.each(["legacy", "multi-channel"])("sends only the exact secondary contact email through %s", async path => {
    m.campaign.mockResolvedValue({ id: "campaign", subject: "Hi {{client.firstName}}", htmlBody: "Hello", audience: { type: "single_recipient", filters: { email: " SECONDARY@example.invalid " } }, channel: "EMAIL" });
    m.clients.mockResolvedValue([{ ...recipient, users: [{ phone: null }] }]);
    if (path === "legacy") await dispatchEmailCampaignById("campaign"); else await sendCampaign("campaign");
    expect(m.email).toHaveBeenCalledOnce();
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "secondary@example.invalid", subject: "Hi Alice" }));
    expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ email: "secondary@example.invalid" }) }));
  });
  it.each(["legacy", "multi-channel"])("never falls back to broadcast for an invalid explicit %s audience", async path => {
    m.campaign.mockResolvedValue({ id: "campaign", subject: "Hi", htmlBody: "Hello", audience: { type: "single_recipient", filters: { email: "invalid" } }, channel: "EMAIL" });
    await expect(path === "legacy" ? dispatchEmailCampaignById("campaign") : sendCampaign("campaign")).rejects.toThrow();
    expect(m.clients).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled(); expect(m.sms).not.toHaveBeenCalled();
  });
  it.each(["legacy", "multi-channel"])("applies email suppression to an exact recipient in %s", async path => {
    m.campaign.mockResolvedValue({ id: "campaign", subject: "Hi", htmlBody: "Hello", audience: { type: "single_recipient", filters: { email: "secondary@example.invalid" } }, channel: "EMAIL" });
    m.clients.mockResolvedValue([{ ...recipient, users: [] }]); m.suppressed.mockResolvedValue(true);
    if (path === "legacy") await dispatchEmailCampaignById("campaign"); else await sendCampaign("campaign");
    expect(m.suppressed).toHaveBeenCalledWith("secondary@example.invalid"); expect(m.email).not.toHaveBeenCalled();
  });
  it.each(CAMPAIGN_TEMPLATES)("resolves every published variable in catalog template $id", async template => {
    const rendered = await renderCampaignContent({ subject: template.subject, body: renderEmailHtml(templateToDesign(template)) }, { client: { id: recipient.id } });
    expect(rendered.subject + rendered.html).not.toMatch(/\{\{[^}]+\}\}/);
    if (template.smsBody) expect((await renderCampaignContent({ body: template.smsBody }, { client: { id: recipient.id } })).text).not.toMatch(/\{\{[^}]+\}\}/);
  });
  it.each(["legacy", "multi-channel"])("renders client first and last names through the %s send path", async path => {
    if (path === "legacy") await dispatchEmailCampaignById("campaign"); else await sendCampaign("campaign");
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: recipient.email, subject: "Hi Alice", html: "<p>Hello Alice Smith</p>" }));
    expect(m.claim).toHaveBeenCalledOnce();
  });
  it.each(["legacy", "multi-channel"])("keeps personalization isolated between recipients in %s delivery", async path => {
    const second = { ...recipient, id: "client-2", name: "Bob Jones", email: "bob@example.invalid" };
    m.clients.mockResolvedValue([recipient, second]);
    m.client.mockImplementation(async ({ where }) => where.id === second.id ? second : recipient);
    if (path === "legacy") await dispatchEmailCampaignById("campaign"); else await sendCampaign("campaign");
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: recipient.email, subject: "Hi Alice" }));
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: second.email, subject: "Hi Bob", html: "<p>Hello Bob Jones</p>" }));
  });
  it("escapes recipient markup in HTML but keeps subject and SMS text readable", async () => {
    m.client.mockResolvedValue({ ...recipient, name: '<Alice> O\'Neil & Co' });
    const output = await renderCampaignContent({ subject: "For {{client.name}}", body: "<p>{{client.name}}</p>" }, { client: { id: recipient.id } });
    expect(output.subject).toBe("For <Alice> O'Neil & Co");
    expect(output.html).toBe("<p>&lt;Alice&gt; O&#39;Neil &amp; Co</p>");
    expect(output.text).toBe("<Alice> O'Neil & Co");
  });
  it("uses there for an unnamed greeting and empty for an optional null field", async () => {
    m.client.mockResolvedValue({ ...recipient, name: " " });
    expect(await renderCampaignContent({ subject: "Hi {{client.firstName}}", body: "Suburb: {{client.suburb}}" }, { client: { id: recipient.id } })).toMatchObject({ subject: "Hi there", html: "Suburb: " });
  });
  it("does not evaluate template expressions contained in recipient data", async () => {
    m.client.mockResolvedValue({ ...recipient, name: "{{client.suburb}} Smith", suburb: "Private" });
    const output = await renderCampaignContent({ body: "{{client.firstName}} / {{client.suburb}}" }, { client: { id: recipient.id } });
    expect(output.html).toBe("{{client.suburb}} / Private");
  });
  it.each(["client.fristName", "client.__proto__", "missing.name"])("rejects unsupported variable %s before a legacy ledger claim or delivery", async variable => {
    m.campaign.mockResolvedValue({ id: "campaign", subject: "Test", htmlBody: `Hi {{${variable}}}`, audience: { type: "all_clients" } });
    await expect(dispatchEmailCampaignById("campaign")).rejects.toThrow(/campaign variable/i);
    expect(m.claim).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled();
  });
  it("marks a multi-channel recipient failed without delivering unresolved variables", async () => {
    m.campaign.mockResolvedValue({ id: "campaign", subject: "Test", htmlBody: "{{client.unknown}}", audience: { type: "all_clients" }, channel: "BOTH" });
    expect(await sendCampaign("campaign")).toMatchObject({ sent: 0, failed: 1 });
    expect(m.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ campaignStatus: "FAILED", status: "failed", sentAt: null }) }));
    expect(m.email).not.toHaveBeenCalled(); expect(m.sms).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
  });
});
