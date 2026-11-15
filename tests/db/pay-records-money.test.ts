// @vitest-environment node
/**
 * Pay records (boards "Pay run", "Cleaner invoice", "Shopping run",
 * 2026-11-17) on a real disposable PostgreSQL (127.0.0.1:55439), with real
 * concurrency where money moves:
 *  - Process payouts twice at once processes once (one 200, one 409, one
 *    history row); a Failed run is refused with the way forward; Set back to
 *    Confirmed is ADMIN only, needs a reason and the own PIN, and repeats as
 *    a no-op; testing as someone is refused before any credential is read.
 *  - Marking one payout paid twice at once records it once; operations
 *    managers may do it.
 *  - Approving a cleaner invoice twice at once approves it once.
 *  - A shopping reimbursement needs a receipt or a typed note; approving twice
 *    at once writes one audited approval for the costed amount only, naming
 *    the line with no cost; the page shows that line as missing, not $0.
 *  - The payout breakdown reads the stored rate snapshot and stored amounts.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  session: null as null | { user: { id: string; role: string; heldRoles?: string[] }; impersonation?: { actorId: string } },
  verifyCalls: [] as Array<{ userId: string; action: string | undefined }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: async (roles: string[]) => {
    if (!m.session) throw new Error("UNAUTHORIZED");
    if (!roles.includes(m.session.user.role)) throw new Error("FORBIDDEN");
    return m.session;
  },
}));
// The own-PIN check has its own suite; here "2468" is the right PIN.
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return {
    ...actual,
    verifySensitiveAction: async (userId: string, credentials: { pin?: string } | null, action?: string) => {
      m.verifyCalls.push({ userId, action });
      if (credentials?.pin !== "2468") throw new actual.SensitiveVerificationError("INVALID_SECURITY_VERIFICATION");
      return true;
    },
  };
});
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/cleaner/invoice-admin-notify", () => ({ notifyPayeeOfChangeRequest: vi.fn(async () => undefined), sendPayeeRemittance: vi.fn(async () => undefined) }));

import { POST as processPost } from "@/app/api/admin/payroll/runs/[id]/process/route";
import { PATCH as runPatch } from "@/app/api/admin/payroll/runs/[id]/route";
import { PATCH as invoicePatch } from "@/app/api/admin/cleaner-invoices/[id]/route";
import { PATCH as shoppingPatch } from "@/app/api/admin/inventory/shopping-runs/[id]/route";
import { loadPayoutBreakdown } from "@/lib/payroll/payout-breakdown";
import { loadShoppingRunPage } from "@/lib/inventory/shopping-run-page";
import { cleanerInvoicePayRequests } from "@/lib/cleaner/invoice-review-extras";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `prm-${randomUUID().slice(0, 8)}`;
const ids = {
  admin: randomUUID(), ops: randomUUID(), maria: randomUUID(), liam: randomUUID(),
  client: randomUUID(), property: randomUUID(), item: randomUUID(),
  run: randomUUID(), failedRun: randomUUID(), payMaria: randomUUID(), payLiam: randomUUID(), payFailed: randomUUID(),
  job: randomUUID(), adjustment: randomUUID(), invoice: randomUUID(), shopping: randomUUID(),
};

function req(method: string, body: unknown): Request {
  return new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function as(user: string, role: Role, impersonation?: { actorId: string }) {
  m.session = { user: { id: user, role, heldRoles: [role] }, ...(impersonation ? { impersonation } : {}) };
}
const runContext = (id: string) => ({ params: { id } });

describe.skipIf(!url)("pay records: exactly once and the new server rules (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [
      { id: ids.admin, email: `${tag}-admin@example.invalid`, name: "Hannah Lee", role: Role.ADMIN },
      { id: ids.ops, email: `${tag}-ops@example.invalid`, name: "Priya Ops", role: Role.OPS_MANAGER },
      { id: ids.maria, email: `${tag}-maria@example.invalid`, name: "Maria Santos", role: Role.CLEANER, bankBsb: "062000", bankAccountNumber: "12345412" },
      { id: ids.liam, email: `${tag}-liam@example.invalid`, name: "Liam O'Brien", role: Role.CLEANER },
    ] });
    await m.client.client.create({ data: { id: ids.client, name: `${tag} Harbour View Stays` } });
    await m.client.property.create({ data: { id: ids.property, name: `${tag} Bondi Beach House`, clientId: ids.client, address: "1 Beach Rd", suburb: "Bondi" } });
    await m.client.inventoryItem.create({ data: { id: ids.item, name: `${tag} Toilet paper`, category: "Consumables" } });
    const period = { periodStart: new Date("2026-11-01T00:00:00+11:00"), periodEnd: new Date("2026-11-14T23:59:59+11:00") };
    await m.client.payrollRun.createMany({ data: [
      { id: ids.run, ...period, status: "CONFIRMED", totalPayable: 2000, grandTotal: 2050, cleanerCount: 2, confirmedAt: new Date(), createdByUserId: ids.admin },
      { id: ids.failedRun, ...period, status: "FAILED", totalPayable: 746, grandTotal: 746, cleanerCount: 1, createdByUserId: ids.admin },
    ] });
    await m.client.payout.createMany({ data: [
      { id: ids.payMaria, payrollRunId: ids.run, cleanerId: ids.maria, amount: 1410, transportAllowance: 24, adjustments: -42, method: "ABA_FILE", bankBsb: "062000", bankAccountNumber: "12345412" },
      { id: ids.payLiam, payrollRunId: ids.run, cleanerId: ids.liam, amount: 640, method: "MANUAL_BANK_TRANSFER" },
      { id: ids.payFailed, payrollRunId: ids.failedRun, cleanerId: ids.liam, amount: 746, method: "MANUAL_BANK_TRANSFER", status: "FAILED", failureReason: "This account cannot receive payouts yet." },
    ] });
    await m.client.job.create({ data: { id: ids.job, jobNumber: `${tag}-J1032`, propertyId: ids.property, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-02T00:00:00+11:00"), status: "COMPLETED", payrollRunId: ids.run } });
    await m.client.jobAssignment.create({ data: { jobId: ids.job, userId: ids.maria, payRate: 33 } });
    await m.client.cleanerPayAdjustment.create({ data: { id: ids.adjustment, cleanerId: ids.maria, jobId: ids.job, title: "Rework deduction", type: "FIXED", requestedAmount: -42, approvedAmount: -42, status: "APPROVED", includedInPayrollRunId: ids.run } });
    await m.client.cleanerInvoiceSubmission.create({ data: { id: ids.invoice, cleanerId: ids.maria, ...period, totalAmount: 1163.5, jobCount: 1, status: "SUBMITTED", lineData: { lines: [{ description: "1 Nov · Bondi", quantity: 1, unitAmount: 1163.5 }], jobIds: [] } } });
    await m.client.cleanerPayAdjustment.create({ data: { cleanerId: ids.maria, title: "Oven deep clean", type: "FIXED", requestedAmount: 40, approvedAmount: 40, status: "APPROVED", includedInCleanerInvoiceId: ids.invoice } });
    await m.client.shoppingRun.create({
      data: {
        id: ids.shopping, ownerUserId: ids.maria, clientId: ids.client, status: "SUBMITTED", title: `${tag} Weekly top-up`,
        createdAt: new Date("2026-11-12T16:48:00+11:00"), startedAt: new Date("2026-11-13T10:20:00+11:00"), submittedAt: new Date("2026-11-13T13:05:00+11:00"),
        legacySource: { ownerScope: "CLEANER", cleanerReimbursementStatus: "PENDING_APPROVAL", clientChargeStatus: "READY", source: "db" },
        lines: { create: [
          { propertyId: ids.property, itemId: ids.item, itemName: "Toilet paper", category: "Consumables", plannedQty: 12, purchasedQty: 12, unitCost: 0.95, lineCost: 11.4, status: "PURCHASED" },
          { propertyId: ids.property, itemName: "Dishwasher tablets", category: "Kitchen", plannedQty: 2, purchasedQty: 2, unitCost: 18, lineCost: 36, status: "PURCHASED" },
          { propertyId: ids.property, itemName: "Hand wash refill", category: "Bathroom", plannedQty: 3, purchasedQty: 3, unitCost: null, lineCost: null, status: "PURCHASED" },
          { propertyId: ids.property, itemName: "Paper towel", category: "Kitchen", plannedQty: 4, purchasedQty: 0, status: "PENDING" },
        ] },
        settlements: { create: [{ paymentMethod: "CLEANER_CARD", paidByScope: "CLEANER", paidByUserId: ids.maria }] },
      },
    });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.auditLog.deleteMany({ where: { entityId: { in: [ids.run, ids.failedRun, ids.invoice, ids.shopping] } } });
    await m.client.shoppingClientCharge.deleteMany({ where: { shoppingRunId: ids.shopping } });
    await m.client.shoppingRun.deleteMany({ where: { id: ids.shopping } });
    await m.client.cleanerPayAdjustment.deleteMany({ where: { cleanerId: ids.maria } });
    await m.client.cleanerInvoiceSubmission.deleteMany({ where: { id: ids.invoice } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: ids.job } });
    await m.client.job.deleteMany({ where: { id: ids.job } });
    await m.client.payout.deleteMany({ where: { payrollRunId: { in: [ids.run, ids.failedRun] } } });
    await m.client.payrollRun.deleteMany({ where: { id: { in: [ids.run, ids.failedRun] } } });
    await m.client.inventoryItem.deleteMany({ where: { id: ids.item } });
    await m.client.property.deleteMany({ where: { id: ids.property } });
    await m.client.client.deleteMany({ where: { id: ids.client } });
    await m.client.user.updateMany({ where: { id: { in: [ids.admin, ids.ops] } }, data: { isActive: false } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.admin, ids.ops, ids.maria, ids.liam] } } }).catch(() => undefined);
    await m.client.$disconnect();
  });

  it("refuses processing while testing as someone, before any credential is read", async () => {
    as(ids.admin, Role.ADMIN, { actorId: ids.admin });
    m.verifyCalls = [];
    const response = await processPost(req("POST", { security: { pin: "2468" } }) as never, runContext(ids.run));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("ACTUAL_ACTOR_REQUIRED");
    expect(m.verifyCalls).toEqual([]);
    expect((await m.client.payrollRun.findUniqueOrThrow({ where: { id: ids.run } })).status).toBe("CONFIRMED");
  });

  it("refuses processing for an operations manager and without the PIN", async () => {
    as(ids.ops, Role.OPS_MANAGER);
    expect((await processPost(req("POST", { security: { pin: "2468" } }) as never, runContext(ids.run))).status).toBe(403);
    as(ids.admin, Role.ADMIN);
    expect((await processPost(req("POST", { security: { pin: "0000" } }) as never, runContext(ids.run))).status).toBe(423);
    expect((await m.client.payrollRun.findUniqueOrThrow({ where: { id: ids.run } })).status).toBe("CONFIRMED");
  });

  it("processes a run once when Process is sent twice at the same moment", async () => {
    as(ids.admin, Role.ADMIN);
    m.verifyCalls = [];
    const responses = await Promise.all([
      processPost(req("POST", { security: { pin: "2468" } }) as never, runContext(ids.run)),
      processPost(req("POST", { security: { pin: "2468" } }) as never, runContext(ids.run)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(m.verifyCalls.every((call) => call.action === "payroll.process" && call.userId === ids.admin)).toBe(true);
    const audits = await m.client.auditLog.findMany({ where: { entityId: ids.run, action: "PAYROLL_RUN_PROCESSED" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].userId).toBe(ids.admin);
    const run = await m.client.payrollRun.findUniqueOrThrow({ where: { id: ids.run }, include: { payouts: true } });
    expect(run.status).toBe("COMPLETED");
    // Bank payouts stay Pending (Liam, with no bank details, is not blocked and not paid).
    expect(run.payouts.map((payout) => payout.status).sort()).toEqual(["PENDING", "PENDING"]);
    expect(run.payouts.find((payout) => payout.id === ids.payMaria)?.amount).toBe(1410);
  });

  it("records a payout marked paid twice at once only once, for an operations manager", async () => {
    as(ids.ops, Role.OPS_MANAGER);
    const body = { payoutId: ids.payMaria, payoutStatus: "PAID", expectedPayoutStatus: "PENDING" };
    const responses = await Promise.all([runPatch(req("PATCH", body) as never, runContext(ids.run)), runPatch(req("PATCH", body) as never, runContext(ids.run))]);
    expect(responses.every((response) => response.status === 200 || response.status === 409)).toBe(true);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    const payout = await m.client.payout.findUniqueOrThrow({ where: { id: ids.payMaria } });
    expect(payout.status).toBe("PAID");
    const audits = await m.client.auditLog.findMany({ where: { entityId: ids.run, action: "PAYROLL_STATUS_MANUAL_UPDATE" } });
    expect(audits.filter((audit) => (audit.after as { payoutId?: string }).payoutId === ids.payMaria)).toHaveLength(1);
    // A retry of the same request changes nothing.
    const processedAt = payout.processedAt?.toISOString();
    expect((await runPatch(req("PATCH", { payoutId: ids.payMaria, payoutStatus: "PAID" }) as never, runContext(ids.run))).status).toBe(200);
    expect((await m.client.payout.findUniqueOrThrow({ where: { id: ids.payMaria } })).processedAt?.toISOString()).toBe(processedAt);
  });

  it("refuses to process a Failed run and offers Set back to Confirmed: ADMIN, reason and PIN", async () => {
    as(ids.admin, Role.ADMIN);
    const refused = await processPost(req("POST", { security: { pin: "2468" } }) as never, runContext(ids.failedRun));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toMatch(/Set it back to Confirmed/);
    as(ids.ops, Role.OPS_MANAGER);
    const opsRefused = await runPatch(req("PATCH", { status: "CONFIRMED", reason: "Retry after failure", security: { pin: "2468" } }) as never, runContext(ids.failedRun));
    expect(opsRefused.status).toBe(403);
    as(ids.admin, Role.ADMIN, { actorId: ids.admin });
    expect((await runPatch(req("PATCH", { status: "CONFIRMED", reason: "Retry after failure", security: { pin: "2468" } }) as never, runContext(ids.failedRun))).status).toBe(403);
    as(ids.admin, Role.ADMIN);
    expect((await runPatch(req("PATCH", { status: "CONFIRMED", security: { pin: "2468" } }) as never, runContext(ids.failedRun))).status).toBe(400);
    expect((await runPatch(req("PATCH", { status: "CONFIRMED", reason: "Retry after failure", security: { pin: "1111" } }) as never, runContext(ids.failedRun))).status).toBe(423);
    expect((await m.client.payrollRun.findUniqueOrThrow({ where: { id: ids.failedRun } })).status).toBe("FAILED");
    const ok = await runPatch(req("PATCH", { status: "CONFIRMED", expectedStatus: "FAILED", reason: "Retry after failure", security: { pin: "2468" } }) as never, runContext(ids.failedRun));
    expect(ok.status).toBe(200);
    expect((await m.client.payrollRun.findUniqueOrThrow({ where: { id: ids.failedRun } })).status).toBe("CONFIRMED");
    const again = await runPatch(req("PATCH", { status: "CONFIRMED", reason: "Retry after failure", security: { pin: "2468" } }) as never, runContext(ids.failedRun));
    expect(again.status).toBe(200);
    const audits = await m.client.auditLog.findMany({ where: { entityId: ids.failedRun, action: "PAYROLL_STATUS_MANUAL_UPDATE" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: ids.admin, before: { status: "FAILED" }, after: { status: "CONFIRMED", reason: "Retry after failure" } });
    // The payout amount and failure record are untouched by a status correction.
    expect(await m.client.payout.findUniqueOrThrow({ where: { id: ids.payFailed } })).toMatchObject({ amount: 746, status: "FAILED" });
  });

  it("reads a payout's jobs with the stored rate snapshot and its stored adjustment, computing nothing", async () => {
    const breakdown = await loadPayoutBreakdown(ids.run, ids.payMaria);
    expect(breakdown?.jobs).toEqual([expect.objectContaining({ jobId: ids.job, rateSnapshot: 33, day: "2026-11-02", holidayMultiplier: null })]);
    expect(breakdown?.jobs[0]).not.toHaveProperty("amount");
    expect(breakdown?.adjustments).toEqual([expect.objectContaining({ amount: -42 })]);
    expect(await loadPayoutBreakdown(ids.failedRun, ids.payMaria)).toBeNull();
  });

  it("approves a cleaner invoice once when Approve is sent twice at once", async () => {
    as(ids.admin, Role.ADMIN);
    const responses = await Promise.all([invoicePatch(req("PATCH", { status: "APPROVED" }) as never, runContext(ids.invoice)), invoicePatch(req("PATCH", { status: "APPROVED" }) as never, runContext(ids.invoice))]);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect((await m.client.cleanerInvoiceSubmission.findUniqueOrThrow({ where: { id: ids.invoice } })).status).toBe("APPROVED");
    const audits = await m.client.auditLog.findMany({ where: { entityId: ids.invoice, action: "CLEANER_INVOICE_STATUS_UPDATE" } });
    expect(audits).toHaveLength(1);
  });

  it("reads the pay rule band from the stored requested and approved amounts", async () => {
    const requests = await cleanerInvoicePayRequests(ids.invoice, { showClientCharge: false });
    expect(requests).toEqual([expect.objectContaining({ title: "Oven deep clean", requestedAmount: 40, paidAmount: 40, clientCharge: null })]);
  });

  it("shows a bought line with no cost as missing, never as $0, and counts costed lines", async () => {
    const page = await loadShoppingRunPage(ids.shopping);
    const hand = page?.lines.find((line) => line.itemName === "Hand wash refill");
    expect(hand?.cost).toEqual({ state: "missing" });
    expect(page?.coverage).toMatchObject({ boughtLines: 3, costedLines: 2 });
    expect(page?.run.totals.reimbursableCleanerAmount).toBeCloseTo(47.4, 2);
    expect(page?.history.map((entry) => entry.id)).toEqual(["submitted", "started", "created"]);
  });

  it("needs a receipt or a typed note, and approves the reimbursement once for the costed amount", async () => {
    as(ids.ops, Role.OPS_MANAGER);
    const refused = await shoppingPatch(req("PATCH", { cleanerReimbursementStatus: "READY" }) as never, runContext(ids.shopping));
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("RECEIPT_REQUIRED");
    const body = { cleanerReimbursementStatus: "READY", approvalOverrideNote: "Receipt lost; checked against the bank statement" };
    const responses = await Promise.all([shoppingPatch(req("PATCH", body) as never, runContext(ids.shopping)), shoppingPatch(req("PATCH", body) as never, runContext(ids.shopping))]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const audits = await m.client.auditLog.findMany({ where: { entityId: ids.shopping, action: "SHOPPING_REIMBURSEMENT_APPROVED" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].userId).toBe(ids.ops);
    expect(audits[0].after).toMatchObject({
      cleanerReimbursementStatus: "READY",
      amount: 47.4,
      boughtLines: 3,
      costedLines: 2,
      missingCosts: [expect.objectContaining({ itemName: "Hand wash refill", quantity: 3 })],
      receiptCount: 0,
      receiptOverrideNote: "Receipt lost; checked against the bank statement",
    });
    const page = await loadShoppingRunPage(ids.shopping);
    expect(page?.run.cleanerReimbursementStatus).toBe("READY");
    expect(page?.approval).toMatchObject({ by: "Priya Ops", receiptOverrideNote: "Receipt lost; checked against the bank statement" });
  });
});
