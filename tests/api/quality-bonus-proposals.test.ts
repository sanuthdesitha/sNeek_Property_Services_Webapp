// @vitest-environment node
/**
 * Quality → Cleaners → "Propose bonus" (owner decision, sixth set, Wave C):
 * POST /api/admin/quality/bonus-proposals over lib/quality/manual-bonus.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  ops: vi.fn(),
  userFind: vi.fn(),
  transaction: vi.fn(),
  rows: vi.fn(),
  routeCreate: vi.fn(),
  routeAudit: vi.fn(),
  tx: {
    $executeRaw: vi.fn(),
    cleanerPayAdjustment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.ops }));
vi.mock("@/lib/quality/cleaners", () => ({ getCleanerRows: m.rows }));
vi.mock("@/lib/commercial/client-approvals", () => ({ listClientApprovals: async () => [] }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => key }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: m.userFind },
    $transaction: m.transaction,
    cleanerPayAdjustment: { create: m.routeCreate, findUnique: vi.fn() },
    auditLog: { create: m.routeAudit },
    job: { findFirst: vi.fn() },
  },
}));

import { POST } from "@/app/api/admin/quality/bonus-proposals/route";
import { POST as createPayAdjustment } from "@/app/api/admin/pay-adjustments/route";
import { allOpsLevels, canUseOpsPath, type OpsLevels } from "@/lib/rbac/ops-catalog";
import { BONUS_SOURCES } from "@/lib/quality/types";
import { MANUAL_BONUS_MAX_AMOUNT, MANUAL_BONUS_MIN_AMOUNT, pendingBonusWhere } from "@/lib/quality/manual-bonus-rules";

const body = { cleanerId: "cleaner-1", amount: 50, reason: "Spotless month, two client compliments", period: "30d", idempotencyKey: "quality-bonus-abc12345" };
const post = (data: unknown) => POST(new NextRequest("http://localhost/api/admin/quality/bonus-proposals", { method: "POST", body: JSON.stringify(data) }));

function asRole(role: string, extra: Record<string, unknown> = {}) {
  m.auth.mockImplementation(async (roles: string[]) => {
    if (!roles.includes(role)) throw new Error("FORBIDDEN");
    return { user: { id: "office-1", role }, ...extra };
  });
}

const ROW = { cleanerId: "cleaner-1", cleans: 24, reviewed: 20, avgScore: 94.4, streak: { currentStreak: 12, sample: 10, last5Avg: 98, last10Avg: 97 } };

beforeEach(() => {
  vi.resetAllMocks();
  asRole("ADMIN");
  m.ops.mockResolvedValue(null);
  m.userFind.mockResolvedValue({ id: "cleaner-1" });
  m.rows.mockResolvedValue({ rows: [ROW], issueTotal: 0, sort: "score", dir: "desc" });
  m.transaction.mockImplementation(async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx));
  m.tx.cleanerPayAdjustment.findFirst.mockResolvedValue(null);
  m.tx.cleanerPayAdjustment.findMany.mockResolvedValue([]);
  m.tx.cleanerPayAdjustment.create.mockResolvedValue({ id: "adj-1" });
});

describe("who may propose: exactly who may create a pay adjustment", () => {
  it("refuses cleaners and QA inspectors", async () => {
    for (const role of ["CLEANER", "QA_INSPECTOR"]) {
      asRole(role);
      expect((await post(body)).status).toBe(403);
    }
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("an administrator may, independently of packs", async () => {
    expect((await post(body)).status).toBe(201);
  });

  it("an operations manager may only where the pay-adjustment create route would accept them (payroll manage)", async () => {
    asRole("OPS_MANAGER");
    for (const payroll of ["off", "read", "manage"] as const) {
      const levels: OpsLevels = { ...allOpsLevels("manage"), payroll };
      m.ops.mockResolvedValue(levels);
      const allowedByCreateRoute = canUseOpsPath(levels, "/api/admin/pay-adjustments", "POST");
      expect((await post({ ...body, idempotencyKey: `quality-bonus-${payroll}-key` })).status).toBe(allowedByCreateRoute ? 201 : 403);
    }
  });

  it("also needs quality at manage (this route lives in Quality)", async () => {
    asRole("OPS_MANAGER");
    m.ops.mockResolvedValue({ ...allOpsLevels("manage"), quality: "read" });
    expect((await post(body)).status).toBe(403);
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("refuses while impersonating, so the audit names the real person", async () => {
    asRole("ADMIN", { impersonation: { actorId: "real", mode: "FULL", startedAt: 1 } });
    expect((await post(body)).status).toBe(403);
  });

  it("only for a cleaner", async () => {
    m.userFind.mockResolvedValue(null);
    expect((await post(body)).status).toBe(404);
    expect(m.userFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cleaner-1", role: "CLEANER" } }));
  });
});

describe("amount within named bounds, reason required, proposal only", () => {
  it("refuses amounts outside the bounds or with fractions of a cent", async () => {
    for (const amount of [MANUAL_BONUS_MIN_AMOUNT - 0.01, MANUAL_BONUS_MAX_AMOUNT + 0.01, 0, -20, 10.005]) {
      const response = await post({ ...body, amount });
      expect(response.status).toBe(400);
    }
    expect(m.tx.cleanerPayAdjustment.create).not.toHaveBeenCalled();
  });

  it("accepts the bounds themselves", async () => {
    expect((await post({ ...body, amount: MANUAL_BONUS_MIN_AMOUNT })).status).toBe(201);
    expect((await post({ ...body, amount: MANUAL_BONUS_MAX_AMOUNT, idempotencyKey: "quality-bonus-max12345" })).status).toBe(201);
  });

  it("requires a reason", async () => {
    for (const reason of ["", "   ", "ok"]) {
      const response = await post({ ...body, reason });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("A reason is required.");
    }
  });

  it("cannot be approved or paid from here: approval fields are refused and the row is PENDING", async () => {
    expect((await post({ ...body, autoApprove: true })).status).toBe(400);
    expect((await post({ ...body, status: "APPROVED" })).status).toBe(400);
    expect((await post(body)).status).toBe(201);
    const data = m.tx.cleanerPayAdjustment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PENDING", approvedAmount: null, reviewedById: null, reviewedAt: null, requestedAmount: 50, cleanerId: "cleaner-1" });
    expect(data).not.toHaveProperty("includedInPayrollRunId");
    expect(data).not.toHaveProperty("includedInCleanerInvoiceId");
    const audit = m.tx.auditLog.create.mock.calls[0][0].data;
    expect(audit).toMatchObject({ userId: "office-1", action: "PAY_ADJUSTMENT_ADMIN_CREATED", entityId: "adj-1" });
    expect(audit.after).toMatchObject({ approved: false, origin: "manual quality bonus", direction: "ADDITION" });
  });

  it("records the period and cleans it relates to, read on the server", async () => {
    await post(body);
    const [period, filters] = m.rows.mock.calls[0];
    expect(period.key).toBe("30d");
    expect(filters.cleanerId).toBe("cleaner-1");
    const data = m.tx.cleanerPayAdjustment.create.mock.calls[0][0].data;
    expect(data.adminNote).toContain("Spotless month, two client compliments");
    expect(data.adminNote).toContain("Last 30 days: 24 cleans, 20 reviewed, average score 94, current streak 12.");
  });
});

describe("lands in the existing approvals queue, written as the create route writes a pending row", () => {
  it("matches the admin create route's pending row field for field", async () => {
    m.userFind.mockResolvedValue({ id: "cleaner-1" });
    m.routeCreate.mockResolvedValue({ id: "route-1" });
    const routeResponse = await createPayAdjustment(
      new NextRequest("http://localhost/api/admin/pay-adjustments", {
        method: "POST",
        body: JSON.stringify({ cleanerId: "cleaner-1", amount: 50, title: "Quality bonus", note: "n", autoApprove: false }),
      }),
    );
    expect(routeResponse.status).toBe(201);
    const routeData = m.routeCreate.mock.calls[0][0].data;
    await post(body);
    const ours = m.tx.cleanerPayAdjustment.create.mock.calls[0][0].data;
    const { adminNote: _a, sourceKey, ...oursRest } = ours;
    const { adminNote: _b, ...routeRest } = routeData;
    expect(oursRest).toEqual(routeRest);
    expect(sourceKey).toBe("quality-bonus:cleaner-1:quality-bonus-abc12345");
  });

  it("has no automatic source, so the Approvals Pay requests queue (source null or not accountability) lists it", async () => {
    await post(body);
    const data = m.tx.cleanerPayAdjustment.create.mock.calls[0][0].data;
    const source: string | null = data.source ?? null;
    const accountability = ["QA_RECTIFICATION_PAY", "RECTIFICATION_DEDUCTION", "REWORK_DEDUCTION", ...BONUS_SOURCES];
    const inPayRequestsQueue = source === null || !accountability.includes(source);
    expect(inPayRequestsQueue).toBe(true);
  });

  it("the pending-bonus query covers automatic and manual proposals", () => {
    expect(pendingBonusWhere(["c1"])).toEqual({
      cleanerId: { in: ["c1"] },
      status: "PENDING",
      OR: [{ source: { in: [...BONUS_SOURCES] } }, { source: null, sourceKey: { startsWith: "quality-bonus:" } }],
    });
  });
});

describe("a double click cannot create two; a pending bonus is warned about", () => {
  it("replays the first proposal for the same key, under a per-cleaner lock", async () => {
    m.tx.cleanerPayAdjustment.findFirst.mockResolvedValue({ id: "adj-first" });
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "adj-first", duplicate: true, approvalsHref: "/v2/admin/approvals" });
    expect(m.tx.$executeRaw).toHaveBeenCalled();
    expect(m.tx.cleanerPayAdjustment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cleanerId: "cleaner-1", sourceKey: "quality-bonus:cleaner-1:quality-bonus-abc12345" } }),
    );
    expect(m.tx.cleanerPayAdjustment.create).not.toHaveBeenCalled();
  });

  it("refuses with the pending list when a bonus already waits, until the caller acknowledges it", async () => {
    m.tx.cleanerPayAdjustment.findMany.mockResolvedValue([
      { id: "auto-1", title: "Streak bonus", requestedAmount: 20, source: "STREAK_5", createdAt: new Date("2026-11-10T00:00:00Z") },
      { id: "manual-1", title: "Quality bonus", requestedAmount: 30, source: null, createdAt: new Date("2026-11-09T00:00:00Z") },
    ]);
    const refused = await post(body);
    expect(refused.status).toBe(409);
    const payload = await refused.json();
    expect(payload.pending).toEqual([
      { id: "auto-1", title: "Streak bonus", amount: 20, origin: "automatic", createdAt: "2026-11-10T00:00:00.000Z" },
      { id: "manual-1", title: "Quality bonus", amount: 30, origin: "manual", createdAt: "2026-11-09T00:00:00.000Z" },
    ]);
    expect(m.tx.cleanerPayAdjustment.create).not.toHaveBeenCalled();

    expect((await post({ ...body, acknowledgePending: true })).status).toBe(201);
    expect(m.tx.auditLog.create.mock.calls[0][0].data.after.pendingAcknowledged).toEqual(["auto-1", "manual-1"]);
  });

  it("refuses an unknown period instead of answering a different one", async () => {
    expect((await post({ ...body, period: "1y" })).status).toBe(400);
  });
});
