// @vitest-environment node
/**
 * Office amendments of a submitted cleaner invoice on PostgreSQL (2026-11-23):
 * revision history with the original kept, idempotent replay, stale refusal,
 * paid refusal, the Xero flag, delete refused, and the payee's notice through
 * the real office pipeline (inbox intent scoped CLEANER_INVOICE_PAYEE, email
 * through the stubbed provider) respecting the payee's own switches.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, sent: [] as Array<{ to: unknown; subject: string; html?: string }> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: unknown; subject: string; html?: string }) => {
        m.sent.push({ to: payload.to, subject: payload.subject, html: payload.html });
        return { data: { id: `ext-${m.sent.length}` }, error: null };
      },
    };
  },
}));
vi.mock("@/lib/notifications/safeguards/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/safeguards/gate")>("@/lib/notifications/safeguards/gate");
  return { ...actual, guardOutbound: vi.fn(async () => ({ allowed: true, eventId: null, messageClass: "NORMAL" })), recordOutboundOutcome: vi.fn(async () => undefined), refuseOversizedSend: vi.fn(async () => null) };
});

import { amendCleanerInvoice, markXeroBillUpdated, type AmendRequest } from "@/lib/cleaner/invoice-amend";
import { deleteCleanerInvoice, AMENDED_DELETE_REFUSAL } from "@/lib/cleaner/invoice-admin-actions";
import { loadAmendmentHistory, payeeAmendmentView } from "@/lib/cleaner/invoice-amend-history";
import { authorizeEntityRecipient } from "@/lib/notifications/recipient-scopes";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `cia-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const admin = { userId: id("admin"), role: "ADMIN", impersonating: false };
const ops = { userId: id("ops"), role: "OPS_MANAGER", impersonating: false };
const lineData = {
  contact: { name: "Payee" },
  payeeRole: "CLEANER",
  jobIds: [id("job")],
  lines: [
    { kind: "CLEANING", category: "LABOUR", description: "12 Nov · Bondi", quantity: 1, unitAmount: 120 },
    { kind: "CLEANING", category: "REIMBURSEMENT", description: "Extra · parking", quantity: 1, unitAmount: 12 },
  ],
};

async function submission(name: string, extra: Record<string, unknown> = {}) {
  return m.client.cleanerInvoiceSubmission.create({
    data: { id: id(name), cleanerId: id("cleaner"), periodStart: new Date("2026-11-01T00:00:00Z"), periodEnd: new Date("2026-11-15T00:00:00Z"), hours: 4, totalAmount: 132, jobCount: 1, lineData, status: "SUBMITTED", ...extra },
  });
}

function request(row: { updatedAt: Date; amendmentCount: number }, overrides: Partial<AmendRequest> = {}): AmendRequest {
  return {
    requestKey: randomUUID(),
    expectedUpdatedAt: row.updatedAt.toISOString(),
    expectedRevision: row.amendmentCount,
    reason: "The parking was a personal trip.",
    note: null,
    hours: null,
    lines: [{ sourceIndex: 0, description: "12 Nov · Bondi", quantity: 1, unitAmount: 110 }],
    ...overrides,
  };
}

describe.skipIf(!url)("cleaner invoice amendments (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    process.env.RESEND_API_KEY = "re_test_stub";
    process.env.APP_BASE_URL = "https://app.example.invalid";
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    m.sent.length = 0;
    await m.client.user.createMany({ data: [
      { id: id("admin"), email: `${id("admin")}@example.invalid`, role: "ADMIN", name: "Office Admin" },
      { id: id("ops"), email: `${id("ops")}@example.invalid`, role: "OPS_MANAGER", name: "Office Ops" },
      { id: id("cleaner"), email: `${id("cleaner")}@example.invalid`, role: "CLEANER", name: "Pat Payee" },
    ] });
  });
  afterEach(async () => {
    const users = [id("admin"), id("ops"), id("cleaner")];
    await m.client.auditLog.deleteMany({ where: { userId: { in: users } } });
    await m.client.notificationAttempt.deleteMany({ where: { intent: { recipientId: { in: users } } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: users } } });
    await m.client.notification.deleteMany({ where: { userId: { in: users } } });
    // Direct-send receipts (lib/notifications/dispatch-once.ts) for this test's payee only.
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "notificationDispatch:" }, value: { path: ["recipientId"], equals: id("cleaner") } } });
    await m.client.userNotificationPreference.deleteMany({ where: { userId: { in: users } } });
    await m.client.cleanerInvoiceRevision.deleteMany({ where: { submissionId: { startsWith: tag } } });
    await m.client.cleanerInvoiceSubmission.deleteMany({ where: { id: { startsWith: tag } } });
    await m.client.user.deleteMany({ where: { id: { in: users } } });
  });
  afterAll(async () => m.client?.$disconnect());

  it("amends a submitted invoice: keeps the original, records the actual person and reason, and tells the payee in-app and by email", async () => {
    const row = await submission("a");
    const outcome = await amendCleanerInvoice({ id: row.id, actor: ops, request: request(row) });
    expect(outcome).toMatchObject({ ok: true, revision: 1, beforeTotal: 132, afterTotal: 110, needsXeroUpdate: false, replayed: false });
    const stored = await m.client.cleanerInvoiceSubmission.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored).toMatchObject({ status: "SUBMITTED", totalAmount: 110, amendmentCount: 1, xeroOutOfDateSince: null });
    expect((stored.lineData as { lines: unknown[] }).lines).toHaveLength(1);
    const revision = await m.client.cleanerInvoiceRevision.findFirstOrThrow({ where: { submissionId: row.id } });
    expect(revision).toMatchObject({ revision: 1, actorUserId: id("ops"), actorRole: "OPS_MANAGER", reason: "The parking was a personal trip.", beforeTotal: 132, afterTotal: 110 });
    expect(revision.beforeLines).toEqual(lineData.lines);
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { entityId: row.id, action: "CLEANER_INVOICE_AMENDED" } });
    expect(audit.userId).toBe(id("ops"));
    // The notice: an inbox row for the payee and an email, with the changes, total and reason.
    if (!outcome.ok) throw new Error("expected ok");
    expect(outcome.notice?.status).toBe("sent");
    const intent = await m.client.notificationIntent.findFirstOrThrow({ where: { recipientId: id("cleaner"), transport: "INBOX" } });
    expect((intent.envelope as { recipient: { scope: unknown } }).recipient.scope).toEqual({ kind: "ENTITY", type: "CLEANER_INVOICE_PAYEE", id: row.id });
    const inbox = await m.client.notification.findFirstOrThrow({ where: { userId: id("cleaner"), channel: "PUSH" } });
    expect(inbox.body).toContain("Removed “Extra · parking”");
    expect(inbox.body).toContain("Total $132.00 → $110.00");
    expect(inbox.body).toContain("The parking was a personal trip.");
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].html).toContain(`https://app.example.invalid/api/cleaner/invoice/submissions/${row.id}/pdf`);
    expect(m.sent[0].html).toContain("Download the amended invoice");
    expect(m.sent[0].html).toContain("The parking was a personal trip.");
    // The payee's view of it, and the history.
    const history = await loadAmendmentHistory(row.id);
    expect(payeeAmendmentView(history)).toMatchObject({ originalTotal: 132, amendedTotal: 110, amendments: [{ revision: 1 }] });
  });

  it("replays the same request without a second amendment or notice; a reused key with other changes is refused", async () => {
    const row = await submission("b");
    const body = request(row);
    const first = await amendCleanerInvoice({ id: row.id, actor: admin, request: body });
    const again = await amendCleanerInvoice({ id: row.id, actor: admin, request: body });
    expect(again).toMatchObject({ ok: true, replayed: true, revision: 1 });
    expect(first.ok && again.ok && again.afterTotal === first.afterTotal).toBe(true);
    expect(await m.client.cleanerInvoiceRevision.count({ where: { submissionId: row.id } })).toBe(1);
    expect(m.sent).toHaveLength(1);
    expect(await amendCleanerInvoice({ id: row.id, actor: admin, request: { ...body, reason: "Different" } })).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses a stale save, a paid invoice, ops after approval, and testing as someone else", async () => {
    const row = await submission("c");
    expect(await amendCleanerInvoice({ id: row.id, actor: admin, request: request(row, { expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }) })).toMatchObject({ ok: false, status: 409 });
    expect(await amendCleanerInvoice({ id: row.id, actor: { ...admin, impersonating: true }, request: request(row) })).toMatchObject({ ok: false, status: 403 });
    const paid = await submission("paid", { status: "PAID", paidAt: new Date(), paidAmount: 132 });
    expect(await amendCleanerInvoice({ id: paid.id, actor: admin, request: request(paid) })).toMatchObject({ ok: false, status: 409, reason: expect.stringContaining("pay adjustment") });
    const approved = await submission("approved", { status: "APPROVED" });
    expect(await amendCleanerInvoice({ id: approved.id, actor: ops, request: request(approved) })).toMatchObject({ ok: false, status: 403 });
    expect(await m.client.cleanerInvoiceRevision.count({ where: { submissionId: { startsWith: tag } } })).toBe(0);
    expect(m.sent).toHaveLength(0);
  });

  it("flags an amended Xero bill as out of date until the office records it updated, and keeps amended invoices from deletion", async () => {
    const row = await submission("x", { status: "XERO_PUSHED", xeroBillId: "bill-1", xeroExportedAt: new Date() });
    const outcome = await amendCleanerInvoice({ id: row.id, actor: admin, request: request(row) });
    expect(outcome).toMatchObject({ ok: true, needsXeroUpdate: true });
    const stored = await m.client.cleanerInvoiceSubmission.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe("XERO_PUSHED");
    expect(stored.xeroOutOfDateSince).not.toBeNull();
    expect(await markXeroBillUpdated({ id: row.id, actor: admin, expectedUpdatedAt: stored.updatedAt.toISOString(), note: "Edited the bill lines in Xero" })).toEqual({ ok: true });
    expect((await m.client.cleanerInvoiceSubmission.findUniqueOrThrow({ where: { id: row.id } })).xeroOutOfDateSince).toBeNull();

    const plain = await submission("d");
    const amended = await amendCleanerInvoice({ id: plain.id, actor: admin, request: request(plain) });
    expect(amended.ok).toBe(true);
    expect(await deleteCleanerInvoice(plain.id, { id: id("admin"), role: "ADMIN" })).toEqual({ status: 409, body: { error: AMENDED_DELETE_REFUSAL } });
  });

  it("respects the payee's own switch: the in-app notice is not sent, and the record says so", async () => {
    await m.client.userNotificationPreference.create({ data: { userId: id("cleaner"), categories: {}, switches: { "type:job.cleaner_invoice_amended:APP": false, "type:job.cleaner_invoice_amended:EMAIL": false } } as never });
    const row = await submission("e");
    const outcome = await amendCleanerInvoice({ id: row.id, actor: admin, request: request(row) });
    if (!outcome.ok || outcome.notice?.status !== "sent") throw new Error("expected a recorded notice");
    expect(outcome.notice.outcomes.find((item) => item.transport === "INBOX")).toMatchObject({ state: "skipped", errorCode: "recipient_switched_off" });
    expect(m.sent).toHaveLength(0);
  });

  it("scopes the notice to the payee who submitted the invoice", async () => {
    const row = await submission("f");
    expect(await authorizeEntityRecipient(m.client as never, { userId: id("cleaner"), role: "CLEANER", scope: { kind: "ENTITY", type: "CLEANER_INVOICE_PAYEE", id: row.id } })).toEqual({ ok: true, role: "CLEANER" });
    expect(await authorizeEntityRecipient(m.client as never, { userId: id("ops"), role: "OPS_MANAGER", scope: { kind: "ENTITY", type: "CLEANER_INVOICE_PAYEE", id: row.id } })).toMatchObject({ ok: false });
  });
});
