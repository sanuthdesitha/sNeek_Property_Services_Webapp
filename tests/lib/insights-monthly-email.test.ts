// @vitest-environment node
/** Monthly Insights email with mocked database, Insights service and notification pipeline. Nothing real is sent. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  settingFind: vi.fn(), settingCreate: vi.fn(), settingUpdate: vi.fn(), settingUpsert: vi.fn(), settingMany: vi.fn(),
  users: vi.fn(), audit: vi.fn(), ops: vi.fn(), business: vi.fn(), send: vi.fn(), controls: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {
  appSetting: { findUnique: m.settingFind, create: m.settingCreate, update: m.settingUpdate, upsert: m.settingUpsert, findMany: m.settingMany },
  user: { findMany: m.users },
  auditLog: { create: m.audit },
  $transaction: async (ops: unknown[]) => ops,
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek" }) }));
vi.mock("@/lib/app-url", () => ({ getAppBaseUrl: () => "https://app.test", resolveAppUrl: (path: string) => `https://app.test${path}` }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/insights/business", () => ({ getBusinessInsights: m.business }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: m.controls }));

import { runMonthlyInsightsEmail, saveInsightsEmailSettings, sendInsightsEmailTest } from "@/lib/insights/monthly-email";
import { buildInsightsEmail } from "@/lib/insights/monthly-email-content";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";

const measure = (value: number | null) => ({ value, basisCount: value === null ? 1 : 10, excludedCount: 0, excluded: {}, enough: value !== null, reason: value === null ? "Not enough data" : undefined, previous: null, delta: null, deltaKind: "percent" as const });
const payload = (finance: boolean) => ({
  period: {}, access: { finance },
  cards: {
    cleans: measure(40), onTime: measure(90), hoursRatio: measure(null), reworkRate: measure(2),
    ...(finance ? { revenue: measure(12000), margin: measure(35), revenueSplit: { invoiced: 11000, invoicedCleans: 36, notYetInvoiced: 1000, notYetInvoicedCleans: 4 } } : {}),
  },
  weekly: null, properties: { rows: [], total: 0, rankedBy: "hours" }, findings: [],
});

const NOW = new Date("2026-11-02T00:00:00Z"); // 2 Nov 11:00 Sydney
const settings = { enabled: true, recipientIds: ["admin", "ops-nofin", "gone"], dayOfMonth: 1, hour: 8, sections: ["money", "work", "quality", "findings"] };

beforeEach(() => {
  vi.clearAllMocks();
  m.settingFind.mockResolvedValue({ value: settings });
  m.settingCreate.mockResolvedValue({});
  m.settingUpdate.mockResolvedValue({});
  m.users.mockResolvedValue([
    { id: "admin", name: "Ann", email: "ann@x", role: "ADMIN" },
    { id: "ops-nofin", name: "Oli", email: "oli@x", role: "OPS_MANAGER" },
    { id: "ops-noreports", name: "Pat", email: "pat@x", role: "OPS_MANAGER" },
  ]);
  m.ops.mockImplementation(async (user: { id: string; role: string }) => {
    if (user.role === "ADMIN") return null;
    if (user.id === "ops-nofin") return { ...allOpsLevels("off"), reports: "read" };
    return allOpsLevels("off");
  });
  m.business.mockImplementation(async (_period: unknown, _filters: unknown, access: { finance: boolean }) => payload(access.finance));
  m.controls.mockResolvedValue({ disabledTransports: {}, respectsPreferences: {} });
  m.send.mockImplementation(async (input: { recipients: Array<{ id: string }> }) => input.recipients.map((recipient) => ({ userId: recipient.id, name: recipient.id, transport: "EMAIL", path: "direct", state: "provider_accepted" })));
});

describe("monthly Insights email", () => {
  it("sends last month's summary once, by EMAIL only, to recipients re-checked now, with money only for finance access", async () => {
    const result = await runMonthlyInsightsEmail(NOW);
    expect(result).toMatchObject({ status: "sent", month: "2026-10", skippedRecipients: ["gone"] });
    expect(m.settingCreate).toHaveBeenCalledWith({ data: { key: "insightsMonthlyEmailSent:2026-10", value: expect.objectContaining({ state: "sending" }) } });
    const input = m.send.mock.calls[0][0];
    expect(input).toMatchObject({ transports: ["EMAIL"], scopeType: "STAFF_MEMBER", typeKey: "insights.monthly_email", eventId: "insights-monthly:2026-10", actorId: null });
    expect(input.recipients.map((r: { id: string }) => r.id)).toEqual(["admin", "ops-nofin"]);
    const adminEmail = input.email({ id: "admin", name: "Ann" });
    const opsEmail = input.email({ id: "ops-nofin", name: "Oli" });
    expect(adminEmail.html).toContain("Revenue");
    expect(adminEmail.html).toContain("not yet invoiced");
    expect(opsEmail.html).not.toContain("Revenue");
    expect(opsEmail.html).toContain("Money figures are left out");
    expect(adminEmail.html).toContain("Not enough data");
    expect(m.settingUpdate.mock.calls[0][0].data.value).toMatchObject({ state: "done", deliveryConfirmed: false, outcomes: [expect.objectContaining({ state: "provider_accepted" }), expect.anything()] });
  });

  it("a restart or a second worker cannot send twice: the month's marker already exists", async () => {
    m.settingCreate.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5" }));
    expect(await runMonthlyInsightsEmail(NOW)).toEqual({ status: "already-sent", month: "2026-10" });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("sends nothing while off or before the configured day and hour", async () => {
    m.settingFind.mockResolvedValue({ value: { ...settings, enabled: false } });
    expect((await runMonthlyInsightsEmail(NOW)).status).toBe("skipped");
    m.settingFind.mockResolvedValue({ value: { ...settings, dayOfMonth: 5 } });
    expect((await runMonthlyInsightsEmail(NOW)).status).toBe("skipped");
    expect(m.settingCreate).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("records a failure truthfully instead of claiming it was sent", async () => {
    m.send.mockRejectedValue(new Error("pipeline down"));
    await expect(runMonthlyInsightsEmail(NOW)).rejects.toThrow("pipeline down");
    expect(m.settingUpdate.mock.calls[0][0].data.value).toMatchObject({ state: "failed", error: "pipeline down" });
  });

  it("the test send goes only to the signed-in person, this month so far, with no marker", async () => {
    await sendInsightsEmailTest({ id: "admin" }, NOW);
    const input = m.send.mock.calls[0][0];
    expect(input.recipients.map((r: { id: string }) => r.id)).toEqual(["admin"]);
    expect(input.eventId).toMatch(/^insights-monthly-test:admin:/);
    expect(input.email({ id: "admin", name: "Ann" }).subject).toContain("so far");
    expect(m.settingCreate).not.toHaveBeenCalled();
    await expect(sendInsightsEmailTest({ id: "ops-noreports" }, NOW)).rejects.toThrow();
  });

  it("only eligible people can be saved as recipients (no free-text addresses)", async () => {
    await expect(saveInsightsEmailSettings({ ...settings, recipientIds: ["ops-noreports"] }, "admin")).rejects.toThrow("Choose recipients");
    await expect(saveInsightsEmailSettings({ ...settings, recipientIds: ["someone@example.com"] }, "admin")).resolves.toMatchObject({ recipientIds: [] });
  });

  it("the content leaves out unchosen sections", () => {
    const content = buildInsightsEmail({ payload: payload(true) as never, sections: ["work"], recipientName: null, companyName: "sNeek", insightsUrl: "u", periodLabel: "October 2026" });
    expect(content.html).not.toContain("Revenue");
    expect(content.html).toContain("Cleans done");
    expect(content.subject).toBe("sNeek business summary: October 2026");
  });
});
