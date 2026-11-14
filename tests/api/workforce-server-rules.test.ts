// @vitest-environment node
/**
 * Workforce server rules (2026-11-16):
 *  - Suspended / Terminated: administrators only (operations managers and an
 *    administrator testing as a manager are refused), confirmed with the
 *    administrator's own credential in the same request (tier C), audited;
 *    other coaching changes are unchanged for managers;
 *  - a performance window that times out reports "timed_out" (504), never zeros;
 *  - rejecting a document needs a reason; reviews are refused while testing.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), verify: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(), userFind: vi.fn(), review: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({
  db: {
    coachingRecord: { findUnique: m.find },
    user: { findUnique: m.userFind },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ coachingRecord: { update: m.update }, auditLog: { create: m.audit } }),
  },
}));
vi.mock("@/lib/security/admin-verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/admin-verification")>();
  return { ...actual, verifySensitiveAction: m.verify };
});
vi.mock("@/lib/workforce/service", () => ({ reviewStaffDocument: m.review }));

import { PATCH } from "@/app/api/admin/accountability/coaching/[id]/route";
import { POST as workforcePost } from "@/app/api/admin/workforce/route";
import { loadPerformanceWindow } from "@/lib/workforce/performance-window";

const admin = { user: { id: "admin", role: "ADMIN", heldRoles: ["ADMIN"] } };
const ops = { user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] } };
const adminTestingAsOps = { user: { id: "ops", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] }, impersonation: { actorId: "admin", mode: "FULL", startedAt: 1 } };
const patch = (body: Record<string, unknown>) => PATCH(new NextRequest("http://localhost", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "rec" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.find.mockResolvedValue({ id: "rec", status: "OPEN", notes: null, outcome: "NONE", retrainingRequired: false, reviewDate: null });
  m.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "rec", status: "OPEN", notes: null, retrainingRequired: false, reviewDate: null, outcome: "NONE", ...data }));
  m.audit.mockResolvedValue({});
});

describe("Suspended and Terminated", () => {
  it("operations managers and an administrator testing as one are refused", async () => {
    for (const session of [ops, adminTestingAsOps]) {
      m.role.mockResolvedValue(session);
      const response = await patch({ outcome: "SUSPENDED", security: { pin: "1234" } });
      expect(response.status).toBe(403);
    }
    expect(m.update).not.toHaveBeenCalled();
  });

  it("an administrator must confirm with their own PIN in the same request", async () => {
    m.role.mockResolvedValue(admin);
    m.verify.mockRejectedValue(new Error("PIN_OR_PASSWORD_REQUIRED"));
    expect((await patch({ outcome: "TERMINATED" })).status).toBe(423);
    expect(m.update).not.toHaveBeenCalled();

    m.verify.mockResolvedValue("pin");
    const response = await patch({ outcome: "TERMINATED", security: { pin: "1234" } });
    expect(response.status).toBe(200);
    expect(m.verify).toHaveBeenCalledWith("admin", { pin: "1234" });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "admin", action: "COACHING_RECORD_UPDATE", after: { outcome: "TERMINATED", confirmedWithOwnCredential: true } });
  });

  it("managers keep every other coaching change, without a PIN", async () => {
    m.role.mockResolvedValue(ops);
    expect((await patch({ status: "ACKNOWLEDGED", outcome: "RETRAINED", retrainingRequired: true })).status).toBe(200);
    expect(m.verify).not.toHaveBeenCalled();
  });
});

describe("performance windows", () => {
  it("a window that does not finish in time is 'timed_out', not a set of zeros", async () => {
    const result = await loadPerformanceWindow("u", 365, { timeoutMs: 5, compute: () => new Promise(() => undefined) });
    expect(result).toEqual({ status: "timed_out", windowDays: 365 });
  });

  it("a failing window is 'failed'; a finished one carries its metrics", async () => {
    expect(await loadPerformanceWindow("u", 90, { compute: async () => { throw new Error("db"); } })).toEqual({ status: "failed", windowDays: 90 });
    const done = await loadPerformanceWindow("u", 30, { compute: async () => ({ windowStart: new Date("2026-10-15T00:00:00Z"), quality: { score: 94, sampleSize: 41 } }) as never });
    expect(done).toMatchObject({ status: "ready", windowDays: 30, metrics: { windowStart: "2026-10-15T00:00:00.000Z", quality: { score: 94 } } });
  });
});

describe("document review", () => {
  const review = (body: Record<string, unknown>) => workforcePost(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ action: "REVIEW_DOCUMENT", documentId: "d", ...body }) }));

  it("rejecting needs a reason the person will see", async () => {
    m.role.mockResolvedValue(admin);
    expect((await review({ status: "REJECTED" })).status).toBe(400);
    expect((await review({ status: "REJECTED", notes: "   " })).status).toBe(400);
    m.review.mockResolvedValue({ id: "d" });
    expect((await review({ status: "REJECTED", notes: "Pages missing" })).status).toBe(200);
    expect(m.review).toHaveBeenCalledTimes(1);
  });

  it("is refused while testing as someone else", async () => {
    m.role.mockResolvedValue(adminTestingAsOps);
    expect((await review({ status: "VERIFIED" })).status).toBe(403);
    expect(m.review).not.toHaveBeenCalled();
  });
});
