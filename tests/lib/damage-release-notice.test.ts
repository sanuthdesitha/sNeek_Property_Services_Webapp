// @vitest-environment node
/**
 * The release message (catalog client.damage_released; owner default
 * 2026-11-14, pending confirmation): transports are explicit — an inbox
 * message stays an inbox row (no phone or browser push), email and SMS go
 * only when ticked — recipients are scoped to the job's client, the client's
 * "notifications off" is honoured, and a repeat of the same key is not
 * audited twice. Review and estimate changes leave their history entries.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  report: vi.fn(),
  office: vi.fn(),
  sms: vi.fn(),
  scope: vi.fn(),
  once: vi.fn(),
  notificationCreate: vi.fn(),
  auditFind: vi.fn(),
  auditCreate: vi.fn(),
  item: vi.fn(),
  itemUpdate: vi.fn(),
  reviewRead: vi.fn(),
  tx: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    damageReport: { findUnique: (args: { select?: { clientVisible?: boolean } }) => (args.select && "clientVisible" in args.select ? m.reviewRead(args) : m.report(args)) },
    damageItem: { findUnique: m.item, update: m.itemUpdate },
    notification: { create: m.notificationCreate },
    auditLog: { findFirst: m.auditFind, create: m.auditCreate },
    $transaction: m.tx,
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms, getSmsProviderState: async () => ({ provider: "twilio", configured: true }) }));
vi.mock("@/lib/notifications/recipient-scopes", () => ({ authorizeEntityRecipient: m.scope }));
vi.mock("@/lib/notifications/dispatch-once", () => ({ dispatchNotificationOnce: m.once }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: async () => ({ disabledTransports: {} }), typeRespectsPreferences: () => false }));
vi.mock("@/lib/notifications/wording/render", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/wording/render")>("@/lib/notifications/wording/render");
  return { ...actual, loadNotificationWording: async (key: string) => actual.defaultNotificationWording(key) };
});

import { assertDamageReleaseNoticeSendable, previewDamageReleaseNotice, sendDamageReleaseNotice } from "@/lib/damage/release-notice";
import { reviewAuditAction, reviewDamageReport, setDamageItemCost } from "@/lib/damage/review";
import { catalogEntry, NOTIFICATION_CATALOG } from "@/lib/notifications/catalog";
import { wordingDefinition } from "@/lib/notifications/wording/registry";
import { DEFAULT_RELEASE_TRANSPORTS } from "@/lib/damage/release-notice-types";

const client = (notificationsEnabled = true) => ({
  id: "client1",
  name: "Harbour View Stays",
  notificationPref: { notificationsEnabled },
  users: [{ id: "olivia", role: "CLIENT", name: "Olivia Grant", email: "olivia@example.test", phone: "+61400000000" }],
});
const report = (enabled = true) => ({
  id: "report1",
  jobId: "job1",
  _count: { items: 3 },
  job: { scheduledDate: new Date("2026-11-10T01:00:00.000Z") },
  property: { name: "Bondi Beach House", client: client(enabled) },
});
const request = (transports: Array<"INBOX" | "EMAIL" | "SMS">) => ({ actorId: "admin", reportId: "report1", request: { transports, idempotencyKey: "release:key12345" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.report.mockResolvedValue(report());
  m.office.mockImplementation(async (input: { transports: string[] }) => input.transports.map((transport) => ({ userId: "olivia", name: "Olivia Grant", transport, path: "pipeline", state: transport === "INBOX" ? "inbox_available" : "queued" })));
  m.scope.mockResolvedValue({ ok: true, role: "CLIENT" });
  m.once.mockImplementation(async (_identity: unknown, send: () => Promise<void>) => { await send(); return true; });
  m.sms.mockResolvedValue({ ok: true, status: "sent", provider: "twilio" });
  m.auditFind.mockResolvedValue(null);
});

describe("catalog and wording", () => {
  it("lists the type with inbox and email by default, SMS available, and its producer", () => {
    const entry = catalogEntry("client.damage_released");
    expect(entry).toMatchObject({ audienceKeys: ["CLIENT"], transports: ["INBOX", "EMAIL", "SMS"], defaultTransports: ["INBOX", "EMAIL"], eventKeys: ["client.damage_released"] });
    expect(entry?.producers).toContain("lib/damage/release-notice.ts");
    expect(NOTIFICATION_CATALOG.filter((row) => row.key === "client.damage_released")).toHaveLength(1);
    expect(DEFAULT_RELEASE_TRANSPORTS).toEqual(["INBOX", "EMAIL"]);
  });

  it("has editable wording for inbox, email and SMS", () => {
    const definition = wordingDefinition("client.damage_released");
    expect(definition?.status).toBe("EDITABLE");
    expect(definition?.parts.map((part) => part.transport).sort()).toEqual(["EMAIL", "INBOX", "SMS"]);
  });
});

describe("sending", () => {
  it("inbox only stays an inbox row: no push, no email, no SMS", async () => {
    const result = await sendDamageReleaseNotice(request(["INBOX"]));
    expect(m.office).toHaveBeenCalledTimes(1);
    const input = m.office.mock.calls[0][0];
    expect(input.transports).toEqual(["INBOX"]);
    expect(input.transports).not.toContain("PUSH");
    expect(input).toMatchObject({ typeKey: "client.damage_released", scopeType: "JOB_CLIENT_CONTACT", jobId: "job1", url: "/v2/client/damage/report1" });
    expect(input.scopeId({})).toBe("job1");
    expect(input.subject).toBe("A damage report for Bondi Beach House is ready");
    expect(input.body).toBe("Our cleaner recorded 3 items after the clean on Tue 10 Nov. Please review and acknowledge it in your portal.");
    expect(m.sms).not.toHaveBeenCalled();
    expect(result).toMatchObject({ taken: true, replayed: false });
  });

  it("sends inbox and email through the pipeline and SMS through the chokepoint only when ticked", async () => {
    const result = await sendDamageReleaseNotice(request(["INBOX", "EMAIL", "SMS"]));
    expect(m.office.mock.calls[0][0].transports).toEqual(["INBOX", "EMAIL"]);
    expect(m.scope).toHaveBeenCalledWith(expect.anything(), { userId: "olivia", role: "CLIENT", scope: { kind: "ENTITY", type: "JOB_CLIENT_CONTACT", id: "job1" } });
    expect(m.sms).toHaveBeenCalledWith("+61400000000", expect.stringContaining("Bondi Beach House"), undefined, expect.objectContaining({ typeKey: "client.damage_released" }));
    expect(result.outcomes.map((outcome) => [outcome.transport, outcome.state])).toEqual([["INBOX", "inbox_available"], ["EMAIL", "queued"], ["SMS", "provider_accepted"]]);
    expect(result.outcomes.some((outcome) => /read|delivered/.test(outcome.state))).toBe(false);
    const audit = m.auditCreate.mock.calls[0][0].data;
    expect(audit).toMatchObject({ action: "DAMAGE_RELEASE_NOTICE_SENT", entity: "DamageReport", entityId: "report1", after: expect.objectContaining({ transports: ["INBOX", "EMAIL", "SMS"], deliveryConfirmed: false }) });
  });

  it("skips an SMS to a login no longer in the client's scope", async () => {
    m.scope.mockResolvedValue({ ok: false, errorCode: "recipient_not_in_scope" });
    const result = await sendDamageReleaseNotice(request(["SMS"]));
    expect(m.sms).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([expect.objectContaining({ transport: "SMS", state: "skipped", errorCode: "recipient_not_in_scope" })]);
  });

  it("sends nothing and is refused when the client switched notifications off", async () => {
    m.report.mockResolvedValue(report(false));
    await expect(assertDamageReleaseNoticeSendable("report1", ["INBOX"])).rejects.toThrow("switched off notifications");
    await expect(sendDamageReleaseNotice(request(["INBOX"]))).rejects.toThrow("switched off notifications");
    expect(m.office).not.toHaveBeenCalled();
    expect((await previewDamageReleaseNotice("report1")).refusal).toBe("This client has switched off notifications.");
  });

  it("does nothing for an empty transport list (a silent release)", async () => {
    expect(await sendDamageReleaseNotice(request([]))).toEqual({ outcomes: [], taken: false, replayed: false });
    await expect(assertDamageReleaseNoticeSendable("report1", [])).resolves.toBeUndefined();
    expect(m.office).not.toHaveBeenCalled();
  });

  it("answers a repeat of the same key without a second audit row", async () => {
    m.auditFind.mockResolvedValue({ id: "earlier" });
    const result = await sendDamageReleaseNotice(request(["INBOX"]));
    expect(result.replayed).toBe(true);
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect(m.office.mock.calls[0][0].eventId).toBe("damage-release:report1:release:key12345");
  });

  it("previews the exact wording and the recipients", async () => {
    const preview = await previewDamageReleaseNotice("report1");
    expect(preview).toMatchObject({ clientName: "Harbour View Stays", refusal: null, title: "A damage report for Bondi Beach House is ready", smsConfigured: true, recipients: [{ id: "olivia", name: "Olivia Grant", hasEmail: true, hasPhone: true }] });
  });
});

describe("history entries for decisions and estimates", () => {
  it("names each decision", () => {
    const under = { clientVisible: false, status: "UNDER_REVIEW" as const };
    expect(reviewAuditAction(under, { release: true })).toBe("DAMAGE_REPORT_RELEASED");
    expect(reviewAuditAction(under, { release: false, close: true })).toBe("DAMAGE_REPORT_CLOSED");
    expect(reviewAuditAction({ clientVisible: true, status: "UNDER_REVIEW" as const }, { release: false })).toBe("DAMAGE_REPORT_TAKEN_BACK");
    expect(reviewAuditAction({ clientVisible: false, status: "CLOSED" as const }, { release: false })).toBe("DAMAGE_REPORT_REOPENED");
  });

  it("writes the decision's entry in the same transaction as the release", async () => {
    m.reviewRead.mockResolvedValue({ id: "report1", status: "UNDER_REVIEW", clientVisible: false, items: [{ caseId: "case1" }] });
    const txCalls: string[] = [];
    m.tx.mockImplementation(async (work: (tx: unknown) => unknown) => work({
      damageReport: { update: async () => { txCalls.push("report"); return { id: "report1" }; } },
      issueTicket: { updateMany: async () => { txCalls.push("cases"); } },
      auditLog: { create: async (args: { data: { action: string } }) => { txCalls.push(args.data.action); } },
    }));
    await reviewDamageReport({ reportId: "report1", reviewerUserId: "admin", release: true });
    expect(txCalls).toEqual(["report", "cases", "DAMAGE_REPORT_RELEASED"]);
  });

  it("refuses an estimate for another report's item, and logs a real change", async () => {
    m.item.mockResolvedValue({ id: "item9", reportId: "other", estimatedCost: null, category: "Rug", area: "Living" });
    await expect(setDamageItemCost({ itemId: "item9", estimatedCost: 70, reportId: "report1", actorUserId: "admin" })).rejects.toThrow("DAMAGE_ITEM_NOT_FOUND");
    expect(m.itemUpdate).not.toHaveBeenCalled();

    m.item.mockResolvedValue({ id: "item1", reportId: "report1", estimatedCost: 350, category: "Benchtop", area: "Kitchen" });
    m.itemUpdate.mockResolvedValue({ id: "item1", estimatedCost: null });
    await setDamageItemCost({ itemId: "item1", estimatedCost: null, reportId: "report1", actorUserId: "admin" });
    expect(m.itemUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { estimatedCost: null } }));
    expect(m.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "DAMAGE_ITEM_ESTIMATE_SET", entityId: "report1", before: { itemId: "item1", estimatedCost: 350 }, after: expect.objectContaining({ estimatedCost: null }) }) });
  });
});
