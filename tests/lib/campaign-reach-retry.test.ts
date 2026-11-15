// @vitest-environment node
/**
 * Marketing (board "Marketing", 2026-11-16): audience and skipped counts before
 * sending, failed sends kept for "Retry the failed", and campaign email that
 * always goes through sendEmailDetailed with `marketing: true` (email design
 * system + one-click unsubscribe + sending safeguards), one message each.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  campaign: vi.fn(), campaignUpdate: vi.fn(), campaignClaim: vi.fn(), clients: vi.fn(),
  sendCreate: vi.fn(), sendUpdateMany: vi.fn(), sendFindMany: vi.fn(), sendCount: vi.fn(),
  email: vi.fn(), suppressed: vi.fn(), suppressionFind: vi.fn(), suppressionMany: vi.fn(), userFirst: vi.fn(), userMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  emailCampaign: { findUnique: m.campaign, update: m.campaignUpdate, updateMany: m.campaignClaim },
  client: { findMany: m.clients },
  campaignSend: { create: m.sendCreate, updateMany: m.sendUpdateMany, findMany: m.sendFindMany, count: m.sendCount },
  emailSuppression: { findUnique: m.suppressionFind, findMany: m.suppressionMany },
  user: { findFirst: m.userFirst, findMany: m.userMany },
} }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/email/suppression", () => ({ isMarketingSuppressed: m.suppressed, isSuppressed: m.suppressed }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountsEmail: "office@example.invalid" }) }));
vi.mock("@/lib/marketing/campaign-render", () => ({ renderCampaignContent: async (source: { subject: string; body: string }) => ({ subject: source.subject, html: source.body, text: source.body }) }));

import { dispatchEmailCampaignById, retryFailedEmailCampaign } from "@/lib/marketing/email-campaigns";
import { classifySuppression, skipReasonsFor } from "@/lib/marketing/campaign-skips";
import { legacyAudienceMatches, summariseReach } from "@/lib/marketing/campaign-reach";

const client = (id: string, email: string | null) => ({ id, name: id, email, users: [], properties: [], invoices: [] });

beforeEach(() => {
  vi.clearAllMocks();
  m.campaign.mockResolvedValue({ id: "c1", status: "draft", subject: "Hello", htmlBody: "<p>Hi</p>", audience: { type: "all_clients" } });
  m.clients.mockResolvedValue([client("a", "a@example.invalid"), client("b", "b@example.invalid"), client("c", "c@example.invalid")]);
  m.suppressed.mockImplementation(async (email: string) => email === "c@example.invalid");
  m.sendCreate.mockResolvedValue({});
  m.sendUpdateMany.mockResolvedValue({ count: 1 });
  m.campaignUpdate.mockResolvedValue({});
  m.suppressionFind.mockResolvedValue({ reason: "MARKETING_OPT_OUT" });
  m.sendCount.mockResolvedValue(0);
});

describe("skipped counts before sending", () => {
  it("names unsubscribes and bounce-list addresses, and totals will-send", async () => {
    expect(classifySuppression("MARKETING_OPT_OUT")).toBe("unsubscribed");
    expect(classifySuppression("UNSUBSCRIBED")).toBe("unsubscribed");
    expect(classifySuppression("HARD_BOUNCE")).toBe("bounce_list");
    expect(classifySuppression("COMPLAINT")).toBe("bounce_list");
    expect(classifySuppression("OK")).toBeNull();
    m.suppressionMany.mockResolvedValue([{ email: "u@example.invalid", reason: "MARKETING_OPT_OUT" }, { email: "b@example.invalid", reason: "HARD_BOUNCE" }]);
    m.userMany.mockResolvedValue([{ email: "C@example.invalid", emailStatus: "COMPLAINT" }]);
    const reasons = await skipReasonsFor(["U@example.invalid", "b@example.invalid", "c@example.invalid", "ok@example.invalid"]);
    expect(summariseReach(["u@example.invalid", "b@example.invalid", "c@example.invalid", "ok@example.invalid"], reasons, 3)).toEqual({
      withEmail: 4, willSend: 1, unsubscribed: 1, bounceList: 2, noEmail: 3,
    });
  });

  it("counts clients without email with the same audience rules the sender uses", () => {
    const facts = { clientId: "x", name: "x", email: "", phone: "", isActive: true, lastJobAt: new Date("2026-01-01"), lastInvoiceAt: null, jobTypes: ["DEEP_CLEAN"], hasCalendarIntegration: false, hasRecurringSchedule: false };
    const now = new Date("2026-11-14");
    expect(legacyAudienceMatches(facts, { type: "inactive_clients", filters: { daysSinceLastBooking: 90 } }, now)).toBe(true);
    expect(legacyAudienceMatches(facts, { type: "service_type", filters: { jobTypes: ["AIRBNB_TURNOVER"] } }, now)).toBe(false);
    expect(legacyAudienceMatches({ ...facts, isActive: false }, { type: "all_clients" }, now)).toBe(false);
  });
});

describe("campaign sending", () => {
  it("sends one message per person through the design system path, records skips and keeps failures", async () => {
    m.email.mockImplementation(async ({ to }: { to: string }) => (to === "b@example.invalid" ? { ok: false, error: "Not sent: TOO_MANY" } : { ok: true, externalId: "msg-a" }));
    m.sendCount.mockImplementation(async ({ where }: { where: { status: string } }) => (where.status === "SENT" ? 1 : 1));
    expect(await dispatchEmailCampaignById("c1")).toEqual({ sent: 1, suppressed: 1, failed: 1 });
    expect(m.email).toHaveBeenCalledTimes(2);
    for (const [payload] of m.email.mock.calls) {
      expect(payload.marketing).toBe(true);
      expect(typeof payload.to).toBe("string");
      expect(payload.transactional).toBeUndefined();
      expect(payload.critical).toBeUndefined();
    }
    expect(m.sendCreate).toHaveBeenCalledWith({ data: { campaignId: "c1", email: "c@example.invalid", status: "SKIPPED", error: "unsubscribed" } });
    expect(m.sendUpdateMany).toHaveBeenCalledWith({ where: { campaignId: "c1", email: "b@example.invalid" }, data: { status: "FAILED", error: "Not sent: TOO_MANY" } });
    expect(m.campaignUpdate).toHaveBeenLastCalledWith({ where: { id: "c1" }, data: { status: "failed", sentAt: null, recipientCount: 1 } });
  });

  it("retry sends only to the failed addresses, re-claims them atomically and marks the campaign sent when none fail", async () => {
    m.campaign.mockImplementation(async ({ select }: { select?: unknown }) => (select ? { id: "c1", status: "failed" } : { id: "c1", status: "sending", subject: "Hello", htmlBody: "<p>Hi</p>", audience: { type: "all_clients" } }));
    m.campaignClaim.mockResolvedValue({ count: 1 });
    m.sendFindMany.mockResolvedValue([{ email: "b@example.invalid" }]);
    m.sendCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    m.email.mockResolvedValue({ ok: true, externalId: "msg-b" });
    m.sendCount.mockImplementation(async ({ where }: { where: { status: string } }) => (where.status === "SENT" ? 2 : 0));
    const result = await retryFailedEmailCampaign("c1");
    expect(result).toEqual({ sent: 1, suppressed: 0, failed: 0, retried: 1 });
    expect(m.email).toHaveBeenCalledOnce();
    expect(m.email.mock.calls[0][0]).toMatchObject({ to: "b@example.invalid", marketing: true });
    expect(m.sendUpdateMany).toHaveBeenCalledWith({ where: { campaignId: "c1", email: "b@example.invalid", status: "FAILED" }, data: { status: "SENT", error: null } });
    expect(m.campaignUpdate).toHaveBeenLastCalledWith({ where: { id: "c1" }, data: { status: "sent", sentAt: expect.any(Date), recipientCount: 2 } });
  });

  it("refuses a retry for a campaign without failed sends, or one already sending", async () => {
    m.campaign.mockResolvedValue({ id: "c1", status: "sent" });
    await expect(retryFailedEmailCampaign("c1")).rejects.toThrow("Only a campaign with failed sends can be retried.");
    m.campaign.mockResolvedValue({ id: "c1", status: "failed" });
    m.campaignClaim.mockResolvedValue({ count: 0 });
    await expect(retryFailedEmailCampaign("c1")).rejects.toThrow("already being sent");
    expect(m.email).not.toHaveBeenCalled();
  });

  it("an address already sent is never emailed twice", async () => {
    m.sendCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    m.sendUpdateMany.mockResolvedValue({ count: 0 });
    m.suppressed.mockResolvedValue(false);
    await dispatchEmailCampaignById("c1");
    expect(m.email).not.toHaveBeenCalled();
  });

  it("no campaign code builds email HTML, calls the provider directly or raises the safeguard limits", () => {
    const root = join(__dirname, "..", "..");
    for (const file of ["lib/marketing/email-campaigns.ts", "lib/marketing/campaign-reach.ts", "lib/marketing/campaign-skips.ts", "app/api/admin/email-campaigns/[id]/retry/route.ts", "app/api/admin/email-campaigns/reach/route.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/from "resend"|resend\.emails|maxRecipientsPerSend|applySendingSafeguards|transactional:\s*true|critical:\s*true/);
    }
    const sender = readFileSync(join(root, "lib/marketing/email-campaigns.ts"), "utf8");
    expect(sender).toMatch(/sendEmailDetailed\(\{[\s\S]*?marketing: true/);
    // No SMS campaigns (owner default): the workspace's sender is email only.
    expect(sender).not.toMatch(/sendSms/);
  });
});
