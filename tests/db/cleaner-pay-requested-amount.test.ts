// @vitest-environment node
/**
 * Owner rule 2026-11-13 on a real PostgreSQL database: after the client
 * approves a pay request's charge at a different amount, approving the
 * cleaner's pay without an amount stores the cleaner's REQUESTED amount, the
 * client approval record (the client charge, stored in AppSetting
 * `client_approvals_v1`) is byte-for-byte unchanged, and the read-only "paid
 * above request" review lists only approved, unpaid pay requests above the
 * request (not settled rows, not rectifications or bonuses).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, session: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async () => m.session }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/notifications/pay-adjustments", () => ({ notifyPayAdjustmentOutcome: vi.fn(async () => undefined) }));
vi.mock("@/lib/notifications/accountability", () => ({ notifyBonusOutcomeToCleaner: vi.fn() }));
vi.mock("@/lib/admin/approval-history-write", () => ({ recordApprovalDecision: vi.fn(async () => undefined) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Test" }) }));

import { PATCH } from "@/app/api/admin/pay-adjustments/[id]/route";
import { createClientApproval, deleteClientApprovalById, getClientApprovalById } from "@/lib/commercial/client-approvals";
import { listPaidAboveRequest } from "@/lib/payroll/paid-above-request";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const createdApprovals: string[] = [];

async function payRequest(suffix: string, data: Record<string, unknown>) {
  return m.client.cleanerPayAdjustment.create({
    data: { id: `${id}-${suffix}`, cleanerId: id, type: "FIXED", requestedAmount: 40, scope: "STANDALONE", ...data } as never,
  });
}

describe.skipIf(!url)("cleaner pay is the requested amount, on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `payrule-${randomUUID()}`;
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER", isActive: true } });
    await m.client.user.create({ data: { id: `${id}-admin`, email: `${id}-admin@example.invalid`, role: "ADMIN", isActive: true } });
    m.session = { user: { id: `${id}-admin`, role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    for (const approvalId of createdApprovals.splice(0)) await deleteClientApprovalById(approvalId);
    await m.client.notification.deleteMany({ where: { userId: id } });
    await m.client.auditLog.deleteMany({ where: { userId: `${id}-admin` } });
    await m.client.cleanerPayAdjustment.deleteMany({ where: { cleanerId: id } });
    await m.client.user.deleteMany({ where: { id: { in: [id, `${id}-admin`] } } });
  });
  afterAll(async () => m.client?.$disconnect());

  it("approves the requested amount after the client approved a higher charge, leaving the client charge untouched", async () => {
    const request = await payRequest("a", {});
    const approval = await createClientApproval({
      clientId: `${id}-client`,
      title: "Additional charge",
      description: "Cleaner requested additional payment.",
      amount: 60,
      requestedByUserId: `${id}-admin`,
      metadata: { source: "pay_adjustment", payAdjustmentId: request.id },
    });
    createdApprovals.push(approval.id);
    // The client approves (the store's own writer, as the client route uses).
    const { respondClientApproval, clientApprovalVersion } = await import("@/lib/commercial/client-approvals");
    await respondClientApproval({ id: approval.id, clientId: approval.clientId, decision: "APPROVE", respondedByUserId: `${id}-client-user`, expectedVersion: clientApprovalVersion(approval) });
    const chargeBefore = await getClientApprovalById(approval.id);
    expect(chargeBefore?.status).toBe("APPROVED");

    const response = await PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify({ status: "APPROVED" }) }) as never, { params: { id: request.id } });
    expect(response.status).toBe(200);
    const stored = await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } });
    expect(stored.status).toBe("APPROVED");
    expect(stored.approvedAmount).toBe(40);
    expect(await getClientApprovalById(approval.id)).toEqual(chargeBefore);

    // An operations manager cannot then raise it to the client charge.
    const raise = await PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify({ approvedAmount: 60 }) }) as never, { params: { id: request.id } });
    expect(raise.status).toBe(403);
    expect((await m.client.cleanerPayAdjustment.findUniqueOrThrow({ where: { id: request.id } })).approvedAmount).toBe(40);
  });

  it("lists only approved, unpaid pay requests above the request for review, and writes nothing", async () => {
    await payRequest("above", { status: "APPROVED", approvedAmount: 60 });
    await payRequest("equal", { status: "APPROVED", approvedAmount: 40 });
    await payRequest("lower", { status: "APPROVED", approvedAmount: 35 });
    await payRequest("pending", { status: "PENDING", approvedAmount: null });
    await payRequest("bonus", { status: "APPROVED", approvedAmount: 60, source: "STREAK_5" });
    const before = await m.client.cleanerPayAdjustment.findMany({ where: { cleanerId: id }, orderBy: { id: "asc" } });
    const flagged = (await listPaidAboveRequest()).filter((row) => row.id.startsWith(id));
    expect(flagged.map((row) => row.id)).toEqual([`${id}-above`]);
    expect(flagged[0]).toMatchObject({ requestedAmount: 40, approvedAmount: 60 });
    const after = await m.client.cleanerPayAdjustment.findMany({ where: { cleanerId: id }, orderBy: { id: "asc" } });
    expect(after).toEqual(before);
  });
});
