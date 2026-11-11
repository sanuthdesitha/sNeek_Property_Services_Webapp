// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => {
  const tx = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    payout: { update: vi.fn(), updateMany: vi.fn() },
    cleanerInvoiceSubmission: { update: vi.fn(), updateMany: vi.fn() },
    jobAssignment: { update: vi.fn(), updateMany: vi.fn() },
  };
  return { requireRole: vi.fn(), tx };
});
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { ...m.tx, $transaction: async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx) } }));

import { PATCH } from "@/app/api/admin/users/[id]/pay/route";
import { computeCleanerPay } from "@/lib/finance/job-money";

const patch = (body: unknown) =>
  PATCH(new NextRequest("http://localhost/api/admin/users/u1/pay", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "u1" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "admin" } });
  m.tx.user.findUnique.mockResolvedValue({ id: "u1", role: "CLEANER", hourlyRate: 34 });
});

describe("PATCH /api/admin/users/[id]/pay", () => {
  it("is ADMIN only — an operations manager is refused with 403", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const res = await patch({ hourlyRate: 40 });
    expect(res.status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(m.tx.user.update).not.toHaveBeenCalled();
  });

  it("refuses rates outside the bounds or with more than two decimals", async () => {
    for (const hourlyRate of [0, -5, 501, 36.555, "36"]) {
      const res = await patch({ hourlyRate });
      expect(res.status).toBe(400);
    }
    expect((await patch({ hourlyRate: 40, extra: true })).status).toBe(400);
    expect(m.tx.user.update).not.toHaveBeenCalled();
  });

  it("writes only User.hourlyRate and audits the old and new value", async () => {
    const res = await patch({ hourlyRate: 36.5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "u1", hourlyRate: 36.5, previousHourlyRate: 34, changed: true });
    expect(m.tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { hourlyRate: 36.5 }, select: { id: true } });
    expect(m.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "admin", action: "UPDATE_USER_PAY_RATE", entityId: "u1", before: { hourlyRate: 34 }, after: { hourlyRate: 36.5 } }),
    });
    // Frozen amounts are never touched by a rate change.
    for (const model of [m.tx.payout, m.tx.cleanerInvoiceSubmission, m.tx.jobAssignment]) {
      expect(model.update).not.toHaveBeenCalled();
      expect(model.updateMany).not.toHaveBeenCalled();
    }
  });

  it("records nothing when the rate is unchanged", async () => {
    const res = await patch({ hourlyRate: 34 });
    expect((await res.json()).changed).toBe(false);
    expect(m.tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses client-side accounts and unknown users", async () => {
    m.tx.user.findUnique.mockResolvedValueOnce({ id: "u1", role: "CLIENT", hourlyRate: null });
    expect((await patch({ hourlyRate: 40 })).status).toBe(400);
    m.tx.user.findUnique.mockResolvedValueOnce(null);
    expect((await patch({ hourlyRate: 40 })).status).toBe(404);
  });
});

describe("what a rate change reaches in the pay computation", () => {
  const job = { jobType: "AIRBNB_TURNOVER", estimatedHours: 2 } as Parameters<typeof computeCleanerPay>[0];
  const context = { cleanerId: "u1", activeAssignmentCount: 1 };

  it("leaves an assignment with a saved payRate snapshot unchanged", () => {
    const before = computeCleanerPay(job, { payRate: 30, userHourlyRate: 34 }, {}, context);
    const after = computeCleanerPay(job, { payRate: 30, userHourlyRate: 50 }, {}, context);
    expect(after.total).toBe(before.total);
    expect(after.rate).toBe(30);
  });

  it("leaves a job-type rate unchanged", () => {
    const settings = { cleanerJobHourlyRates: { u1: { AIRBNB_TURNOVER: 32 } } } as Parameters<typeof computeCleanerPay>[2];
    expect(computeCleanerPay(job, { payRate: null, userHourlyRate: 50 }, settings, context).rate).toBe(32);
  });

  it("uses the new rate only where nothing more specific is saved", () => {
    expect(computeCleanerPay(job, { payRate: null, userHourlyRate: 50 }, {}, context).rate).toBe(50);
  });
});
