// @vitest-environment node
/**
 * Pay requests linked to jobs, billed to the client and settled outside the
 * system (owner request 2026-11-18), on a real PostgreSQL database:
 *
 *   - linking is checked on the server (the cleaner must be on the job, same
 *     property) and audited;
 *   - approval with bill-to-client folds the extra into the job's line on a
 *     DRAFT client invoice (one line, combined total, GST recalculated), edits
 *     re-fold it, un-billing restores the line, an issued invoice is never
 *     touched and the extra lands on the next invoice as its own line, once;
 *   - an extra awaiting or declined by the client is not billed;
 *   - a reduction after approval needs a reason, which is audited;
 *   - "mark paid" keeps the request off the cleaner invoice and payroll, is
 *     refused when already settled, can be undone, is ADMIN only with the
 *     person's own PIN, and cannot race an invoice claim into paying twice.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type TestSession = { user: { id: string; role: string; heldRoles: string[] }; impersonation?: unknown };
const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, session: null as unknown as TestSession }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get: (_target, key) => {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));
// The real role rule, against the test's session.
vi.mock("@/lib/auth/session", () => ({
  requireRole: async (roles: string[]) => {
    if (!roles.includes(m.session.user.role)) throw new Error("FORBIDDEN");
    return m.session;
  },
}));
// The PIN check itself is covered by its own suites; here it only has to
// refuse a wrong PIN and anyone testing as someone else, as the real one does.
vi.mock("@/lib/security/route-verification", async () => {
  const { NextResponse } = await import("next/server");
  return {
    securityFromBody: (body: { security?: unknown } | null) => body?.security,
    routeSecurityRefusal: async (session: TestSession, security: { pin?: string } | null) => {
      if (session.impersonation) return NextResponse.json({ error: "Use your own account.", code: "ACTUAL_ACTOR_REQUIRED" }, { status: 403 });
      if (security?.pin !== "2468") return NextResponse.json({ error: "INVALID_SECURITY_VERIFICATION" }, { status: 423 });
      return null;
    },
  };
});
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/notifications/pay-adjustments", () => ({ notifyPayAdjustmentOutcome: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/accountability", () => ({ notifyBonusOutcomeToCleaner: vi.fn() }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: vi.fn(async () => undefined) }));

import { PATCH } from "@/app/api/admin/pay-adjustments/[id]/route";
import { POST as MARK_PAID, DELETE as UNDO_PAID } from "@/app/api/admin/pay-adjustments/[id]/mark-paid/route";
import { GET as LINK_CANDIDATES } from "@/app/api/admin/pay-adjustments/[id]/link-candidates/route";
import { generateClientInvoice, releaseInvoiceConsumables } from "@/lib/billing/client-invoices";
import { createClientApproval, deleteClientApprovalById } from "@/lib/commercial/client-approvals";
import { getCleanerInvoiceData } from "@/lib/cleaner/invoice";
import { claimCleanerInvoice } from "@/lib/cleaner/invoice-claim";
import { getPayrollSummary } from "@/lib/finance/payroll";
import { ADJUSTMENT_CLAIM_GUARD } from "@/lib/finance/pay-adjustments";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let t = "";
// Ids are cuid-shaped (no hyphens): the PATCH validates job ids as cuids.
const ids = () => ({
  client: `${t}client`,
  property: `${t}prop`,
  otherProperty: `${t}propb`,
  cleaner: `${t}cleaner`,
  otherCleaner: `${t}cleanerb`,
  admin: `${t}admin`,
  ops: `${t}ops`,
  job: `${t}joba`,
  job2: `${t}jobb`,
  job3: `${t}jobc`,
  jobOther: `${t}jobx`,
});
const approvalIds: string[] = [];

function req(body: unknown) {
  return new Request("http://local", { method: "POST", body: JSON.stringify(body) }) as never;
}
async function patch(id: string, body: unknown) {
  const response = await PATCH(req(body), { params: { id } });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}
function asAdmin() {
  m.session = { user: { id: ids().admin, role: "ADMIN", heldRoles: ["ADMIN"] } };
}
function asOps() {
  m.session = { user: { id: ids().ops, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
}

async function payRequest(suffix: string, data: Record<string, unknown> = {}) {
  return m.client.cleanerPayAdjustment.create({
    data: {
      id: `${t}adj${suffix}`,
      cleanerId: ids().cleaner,
      jobId: ids().job,
      propertyId: ids().property,
      scope: "JOB",
      type: "FIXED",
      title: "Oven deep clean",
      requestedAmount: 40,
      cleanerNote: "Oven had baked-on grease",
      ...data,
    } as never,
  });
}

async function draftInvoiceWithJobLine(status: "DRAFT" | "SENT" = "DRAFT") {
  return m.client.clientInvoice.create({
    data: {
      id: `${t}-inv-${status}`,
      clientId: ids().client,
      invoiceNumber: `${t}-INV-${status}`,
      status,
      gstEnabled: true,
      subtotal: 150,
      gstAmount: 15,
      totalAmount: 165,
      ...(status === "SENT" ? { sentAt: new Date() } : {}),
      lines: {
        create: { jobId: ids().job, description: "Harbour Flat - AIRBNB TURNOVER - 10 Nov 2026", quantity: 1, unitPrice: 150, lineTotal: 150, category: "SERVICE" },
      },
    },
    include: { lines: true },
  });
}

describe.skipIf(!url)("pay request links, client billing and settlement, on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    t = `cpayreq${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const i = ids();
    await m.client.user.createMany({
      data: [
        { id: i.cleaner, email: `${i.cleaner}@example.invalid`, name: "Casey Cleaner", role: "CLEANER", isActive: true, hourlyRate: 30 },
        { id: i.otherCleaner, email: `${i.otherCleaner}@example.invalid`, role: "CLEANER", isActive: true },
        { id: i.admin, email: `${i.admin}@example.invalid`, role: "ADMIN", isActive: true },
        { id: i.ops, email: `${i.ops}@example.invalid`, role: "OPS_MANAGER", isActive: true },
      ],
    });
    await m.client.client.create({ data: { id: i.client, name: "Harbour Stays" } });
    await m.client.property.create({ data: { id: i.property, clientId: i.client, name: "Harbour Flat", address: "1 Fixture St", suburb: "Sydney" } });
    await m.client.property.create({ data: { id: i.otherProperty, clientId: i.client, name: "Other Flat", address: "2 Fixture St", suburb: "Sydney" } });
    const job = (id: string, propertyId: string, date: string, cleaner: string) => ({
      id,
      jobNumber: id,
      propertyId,
      jobType: "AIRBNB_TURNOVER" as const,
      status: "COMPLETED" as const,
      fixedPrice: 150,
      estimatedHours: 2,
      scheduledDate: new Date(`${date}T01:00:00.000Z`),
      completedAt: new Date(`${date}T04:00:00.000Z`),
      assignments: { create: { userId: cleaner, payRate: 50, responseStatus: "ACCEPTED" as const } },
    });
    await m.client.job.create({ data: job(i.job, i.property, "2026-11-10", i.cleaner) });
    await m.client.job.create({ data: job(i.job2, i.property, "2026-11-12", i.cleaner) });
    await m.client.job.create({ data: job(i.job3, i.property, "2026-11-13", i.otherCleaner) });
    await m.client.job.create({ data: job(i.jobOther, i.otherProperty, "2026-11-14", i.cleaner) });
    asAdmin();
  });

  afterEach(async () => {
    if (!m.client || !t) return;
    const i = ids();
    for (const id of approvalIds.splice(0)) await deleteClientApprovalById(id);
    await m.client.auditLog.deleteMany({ where: { userId: { in: [i.admin, i.ops] } } });
    await m.client.notification.deleteMany({ where: { userId: { in: [i.cleaner, i.admin, i.ops] } } });
    await m.client.cleanerPayAdjustment.deleteMany({ where: { cleanerId: i.cleaner } });
    await m.client.cleanerInvoiceSubmission.deleteMany({ where: { cleanerId: i.cleaner } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: i.client } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { startsWith: t } } });
    await m.client.job.deleteMany({ where: { id: { startsWith: t } } });
    await m.client.property.deleteMany({ where: { clientId: i.client } });
    await m.client.client.deleteMany({ where: { id: i.client } });
    await m.client.user.deleteMany({ where: { id: { startsWith: t } } });
  });

  afterAll(async () => m.client?.$disconnect());

  it("approval folds the extra into the job's DRAFT line; edits re-fold; un-billing restores; issued is never touched; void releases", async () => {
    const invoice = await draftInvoiceWithJobLine("DRAFT");
    const lineId = invoice.lines[0].id;
    const request = await payRequest("a");

    const approved = await patch(request.id, { status: "APPROVED", approvedAmount: 40 });
    expect(approved.status).toBe(200);
    expect(approved.body.clientBilling).toMatchObject({ state: "ON_DRAFT", mode: "FOLDED", invoiceNumber: invoice.invoiceNumber });
    let line = await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.lineTotal).toBe(190);
    expect(line.description).toBe("Harbour Flat - AIRBNB TURNOVER - 10 Nov 2026\nBase service $150.00\nExtra: Oven deep clean $40.00");
    // The cleaner's note never reaches the client's line.
    expect(line.description).not.toContain("grease");
    let totals = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect([totals.subtotal, totals.gstAmount, totals.totalAmount]).toEqual([190, 19, 209]);
    let row = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ billToClient: true, clientAmount: 40, clientInvoiceLineId: lineId, clientBilledAmount: 40 });
    expect(await m.client.clientInvoiceLine.count({ where: { invoiceId: invoice.id } })).toBe(1);

    // A different client amount re-folds the same line.
    expect((await patch(request.id, { clientAmount: 55.55, clientDescription: "Oven detail clean" })).status).toBe(200);
    line = await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } });
    expect(line.lineTotal).toBe(205.55);
    expect(line.description.split("\n")).toEqual(["Harbour Flat - AIRBNB TURNOVER - 10 Nov 2026", "Base service $150.00", "Extra: Oven detail clean $55.55"]);
    totals = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect([totals.subtotal, totals.gstAmount, totals.totalAmount]).toEqual([205.55, 20.56, 226.11]);

    // A reduction after approval needs a reason the cleaner reads.
    const silent = await patch(request.id, { approvedAmount: 30 });
    expect(silent.status).toBe(400);
    expect(silent.body.code).toBe("REDUCTION_REASON_REQUIRED");
    expect((await patch(request.id, { approvedAmount: 30, changeReason: "Only half the oven was cleaned" })).status).toBe(200);
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: "EDIT_PAY_ADJUSTMENT_AMOUNT" } });
    expect(audit.before).toMatchObject({ approvedAmount: 40 });
    expect(audit.after).toMatchObject({ approvedAmount: 30, changeReason: "Only half the oven was cleaned", reduction: true });
    // The client amount is its own figure: the cleaner's reduction did not move it.
    expect((await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } })).lineTotal).toBe(205.55);

    // Un-billing on a draft restores the line exactly.
    expect((await patch(request.id, { billToClient: false })).status).toBe(200);
    line = await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } });
    expect([line.description, line.unitPrice, line.lineTotal]).toEqual(["Harbour Flat - AIRBNB TURNOVER - 10 Nov 2026", 150, 150]);
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).clientInvoiceLineId).toBeNull();
    expect((await m.client.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).totalAmount).toBe(165);

    // Billed again, then the invoice is sent: the client side is fixed now.
    expect((await patch(request.id, { billToClient: true })).status).toBe(200);
    await m.client.clientInvoice.update({ where: { id: invoice.id }, data: { status: "SENT", sentAt: new Date() } });
    const before = await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } });
    const locked = await patch(request.id, { clientAmount: 70 });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatch(/client invoice .* which is sent/);
    const declineLocked = await patch(request.id, { status: "REJECTED", changeReason: "Not needed" });
    expect(declineLocked.status).toBe(409);
    expect(await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } })).toEqual(before);

    // Voiding releases the extra so it can bill again; the void keeps its lines.
    await m.client.$transaction(async (tx) => {
      await releaseInvoiceConsumables(tx, invoice.id);
      await tx.clientInvoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
    });
    row = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } });
    expect(row.clientInvoiceLineId).toBeNull();
    expect((await m.client.clientInvoiceLine.findUniqueOrThrow({ where: { id: lineId } })).lineTotal).toBe(205.55);
  });

  it("when the job's invoice is already issued the extra waits, then lands ONCE on the next invoice as its own line", async () => {
    const sent = await draftInvoiceWithJobLine("SENT");
    const request = await payRequest("b");
    const approved = await patch(request.id, { status: "APPROVED" });
    expect(approved.status).toBe(200);
    expect(approved.body.clientBilling.state).toBe("WAITING_FOR_INVOICE");
    expect(approved.body.clientBilling.reason).toMatch(/no longer a draft/);
    const untouched = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: sent.id }, include: { lines: true } });
    expect(untouched.totalAmount).toBe(165);
    expect(untouched.lines[0].lineTotal).toBe(150);

    const window = { clientId: ids().client, propertyId: ids().property, periodStart: new Date("2026-11-09T13:00:00Z"), periodEnd: new Date("2026-11-11T12:59:59Z") };
    const next = await generateClientInvoice(window);
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: next.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ jobId: null, propertyId: ids().property, lineTotal: 40, category: "SERVICE" });
    expect(lines[0].description).toBe(`Extra: Oven deep clean $40.00 — for Harbour Flat, 10/11/2026 (job ${ids().job})`);
    const stored = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: next.id } });
    expect([stored.subtotal, stored.gstAmount, stored.totalAmount]).toEqual([40, 4, 44]);
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).clientInvoiceLineId).toBe(lines[0].id);
    // Never twice.
    await expect(generateClientInvoice(window)).rejects.toThrow(/No billable/);
  });

  it("a newly generated draft folds the extra into the job's line", async () => {
    const request = await payRequest("c");
    const approved = await patch(request.id, { status: "APPROVED" });
    expect(approved.body.clientBilling.state).toBe("WAITING_FOR_INVOICE");
    const invoice = await generateClientInvoice({ clientId: ids().client, propertyId: ids().property, periodStart: new Date("2026-11-09T13:00:00Z"), periodEnd: new Date("2026-11-11T12:59:59Z") });
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ jobId: ids().job, lineTotal: 190, unitPrice: 190 });
    expect(lines[0].description).toContain("\nBase service $150.00\nExtra: Oven deep clean $40.00");
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).clientInvoiceLineId).toBe(lines[0].id);
  });

  it("an extra awaiting the client's decision, or declined by them, is not billed", async () => {
    const request = await payRequest("d");
    expect((await patch(request.id, { status: "APPROVED" })).status).toBe(200);
    const approval = await createClientApproval({
      clientId: ids().client,
      title: "Oven",
      description: "",
      amount: 60,
      requestedByUserId: ids().admin,
      metadata: { source: "pay_adjustment", payAdjustmentId: request.id },
    });
    approvalIds.push(approval.id);
    const invoice = await generateClientInvoice({ clientId: ids().client, propertyId: ids().property, periodStart: new Date("2026-11-09T13:00:00Z"), periodEnd: new Date("2026-11-11T12:59:59Z") });
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
    expect(lines.map((line) => line.lineTotal)).toEqual([150]);
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).clientInvoiceLineId).toBeNull();
  });

  it("existing rows behave exactly as before: never billed to the client", async () => {
    const legacy = await payRequest("e", { status: "APPROVED", approvedAmount: 40 });
    expect(legacy.billToClient).toBe(false);
    expect(legacy.clientAmount).toBeNull();
    const invoice = await generateClientInvoice({ clientId: ids().client, propertyId: ids().property, periodStart: new Date("2026-11-09T13:00:00Z"), periodEnd: new Date("2026-11-11T12:59:59Z") });
    expect((await m.client.clientInvoiceLine.findMany({ where: { invoiceId: invoice.id } })).map((line) => line.lineTotal)).toEqual([150]);
  });

  it("links an unlinked request only to a job of the same cleaner at the same property, and audits it", async () => {
    const request = await payRequest("f", { jobId: null, scope: "PROPERTY", requestedAt: new Date("2026-11-12T00:00:00Z") });
    const candidates = await LINK_CANDIDATES(req({}), { params: { id: request.id } });
    const listed = (await candidates.json()) as { jobs: Array<{ id: string }> };
    expect(listed.jobs.map((job) => job.id).sort()).toEqual([ids().job, ids().job2].sort());

    const notAssigned = await patch(request.id, { jobId: ids().job3 });
    expect(notAssigned.status).toBe(409);
    expect(notAssigned.body.error).toMatch(/not assigned/);
    const otherProperty = await patch(request.id, { jobId: ids().jobOther });
    expect(otherProperty.status).toBe(409);
    expect(otherProperty.body.error).toMatch(/different property/);

    asOps();
    expect((await patch(request.id, { jobId: ids().job2 })).status).toBe(200);
    let row = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ jobId: ids().job2, propertyId: ids().property, scope: "JOB", jobLinkedById: ids().ops });
    const linked = await m.client.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: "PAY_ADJUSTMENT_JOB_LINKED" } });
    expect(linked.before).toMatchObject({ jobId: null });
    expect(linked.after).toMatchObject({ jobId: ids().job2 });

    expect((await patch(request.id, { jobId: null })).status).toBe(200);
    row = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } });
    expect(row).toMatchObject({ jobId: null, propertyId: ids().property, scope: "PROPERTY" });

    // Settled requests cannot be re-linked.
    await m.client.cleanerPayAdjustment.update({ where: { id: request.id }, data: { status: "APPROVED", approvedAmount: 40, includedInPayrollRunId: `${t}-run` } });
    const settled = await patch(request.id, { jobId: ids().job2 });
    expect(settled.status).toBe(409);
    expect(settled.body.error).toMatch(/Read only: Paid in pay run/);
  });

  it("mark paid: ADMIN with own PIN only; keeps it off the cleaner invoice and payroll; refused when settled; undo with a reason", async () => {
    const request = await payRequest("g", { status: "APPROVED", approvedAmount: 40, billToClient: false, reviewedAt: new Date("2026-11-11T00:00:00Z") });
    const body = { paidDate: "2026-11-17", method: "BANK_TRANSFER", reference: "TX-77", note: "Paid with the fuel float", security: { pin: "2468" } };

    asOps();
    await expect(MARK_PAID(req(body), { params: { id: request.id } }).then((r) => r.status)).resolves.toBe(403);
    asAdmin();
    m.session.impersonation = { actorId: ids().admin };
    expect((await MARK_PAID(req(body), { params: { id: request.id } })).status).toBe(403);
    delete m.session.impersonation;
    expect((await MARK_PAID(req({ ...body, security: { pin: "0000" } }), { params: { id: request.id } })).status).toBe(423);

    const range = { userId: ids().cleaner, startDate: "2026-11-01", endDate: "2026-11-30", excludePaidJobs: true };
    expect((await getCleanerInvoiceData(range)).includedAdjustmentIds).toContain(request.id);
    const payrollBefore = await getPayrollSummary({ startDate: "2026-11-01", endDate: "2026-11-30", excludePaidJobs: true });
    expect(payrollBefore.flatMap((row) => row.adjustments.map((adjustment) => adjustment.id))).toContain(request.id);

    expect((await MARK_PAID(req(body), { params: { id: request.id } })).status).toBe(200);
    const paid = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } });
    expect(paid).toMatchObject({ paidOutsideMethod: "BANK_TRANSFER", paidOutsideReference: "TX-77", paidOutsideById: ids().admin });
    expect(paid.paidOutsideDate?.toISOString().slice(0, 10)).toBe("2026-11-17");
    expect((await getCleanerInvoiceData(range)).includedAdjustmentIds).not.toContain(request.id);
    const payroll = await getPayrollSummary({ startDate: "2026-11-01", endDate: "2026-11-30", excludePaidJobs: true });
    const payrollIds = payroll.flatMap((row) => row.adjustments.map((adjustment) => adjustment.id));
    expect(payrollIds).not.toContain(request.id);

    const again = await MARK_PAID(req(body), { params: { id: request.id } });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/already marked paid/);
    const edit = await patch(request.id, { approvedAmount: 20, changeReason: "x" });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toMatch(/Undo "marked paid" first/);

    expect((await UNDO_PAID(req({ security: { pin: "2468" } }), { params: { id: request.id } })).status).toBe(400);
    expect((await UNDO_PAID(req({ reason: "Transfer bounced", security: { pin: "2468" } }), { params: { id: request.id } })).status).toBe(200);
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).paidOutsideAt).toBeNull();
    const undone = await m.client.auditLog.findFirstOrThrow({ where: { entityId: request.id, action: "PAY_ADJUSTMENT_PAID_UNDONE" } });
    expect(undone.after).toMatchObject({ changeReason: "Transfer bounced" });
    expect((await getCleanerInvoiceData(range)).includedAdjustmentIds).toContain(request.id);

    // Already in a pay run: refused, naming it.
    await m.client.cleanerPayAdjustment.update({ where: { id: request.id }, data: { includedInPayrollRunId: `${t}-run` } });
    const inRun = await MARK_PAID(req(body), { params: { id: request.id } });
    expect(inRun.status).toBe(409);
    expect(((await inRun.json()) as { error: string }).error).toMatch(/Paid in pay run/);
  });

  it("cannot race an invoice claim into paying twice", async () => {
    const request = await payRequest("h", { status: "APPROVED", approvedAmount: 40 });
    // A cleaner prepared their invoice (it includes the request) ...
    const data = await getCleanerInvoiceData({ userId: ids().cleaner, startDate: "2026-11-01", endDate: "2026-11-30", excludePaidJobs: true });
    expect(data.includedAdjustmentIds).toContain(request.id);
    // ... then the office marked it paid before they sent it.
    expect((await MARK_PAID(req({ paidDate: "2026-11-18", method: "CASH", security: { pin: "2468" } }), { params: { id: request.id } })).status).toBe(200);
    await expect(claimCleanerInvoice({ cleanerId: ids().cleaner, data, lineData: { lines: [] } })).rejects.toThrow(/already claimed or changed/);
    // The whole claim rolled back: no submission, no stamp.
    expect(await m.client.cleanerInvoiceSubmission.count({ where: { cleanerId: ids().cleaner } })).toBe(0);
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).includedInCleanerInvoiceId).toBeNull();

    // Two guarded claims at the same moment: exactly one wins.
    const other = await payRequest("i", { status: "APPROVED", approvedAmount: 40 });
    const [paidOutside, invoiced, payrollRun] = await Promise.all([
      m.client.cleanerPayAdjustment.updateMany({ where: { id: other.id, status: "APPROVED", ...ADJUSTMENT_CLAIM_GUARD }, data: { paidOutsideAt: new Date() } }),
      m.client.cleanerPayAdjustment.updateMany({ where: { id: other.id, status: "APPROVED", ...ADJUSTMENT_CLAIM_GUARD }, data: { includedInCleanerInvoiceId: `${t}-ci` } }),
      m.client.cleanerPayAdjustment.updateMany({ where: { id: other.id, status: "APPROVED", ...ADJUSTMENT_CLAIM_GUARD }, data: { includedInPayrollRunId: `${t}-run` } }),
    ]);
    expect(paidOutside.count + invoiced.count + payrollRun.count).toBe(1);
    const final = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: other.id } });
    expect([final.paidOutsideAt, final.includedInCleanerInvoiceId, final.includedInPayrollRunId].filter(Boolean)).toHaveLength(1);
  });
});
