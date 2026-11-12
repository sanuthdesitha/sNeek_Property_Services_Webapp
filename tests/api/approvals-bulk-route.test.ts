/**
 * POST /api/admin/approvals/bulk: same roles as a single decision, a 400 for
 * a decision the queue does not allow in bulk, and every row handed to the
 * queue's existing single-decision route handler with the panel's body.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ role: vi.fn(), timing: vi.fn(), skip: vi.fn(), opsAccess: vi.fn(), passThrough: { PATCH: vi.fn(), POST: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/db", () => ({ db: { cleanerPayAdjustment: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/commercial/client-approvals", () => ({ getClientApprovalById: vi.fn() }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.opsAccess, getOpsGrants: vi.fn(async () => []) }));
vi.mock("@/app/api/admin/pay-adjustments/[id]/route", () => m.passThrough);
vi.mock("@/app/api/admin/time-adjustments/[id]/route", () => m.passThrough);
vi.mock("@/app/api/admin/job-early-checkouts/[id]/route", () => ({ PATCH: m.timing }));
vi.mock("@/app/api/admin/cleaner-invoices/[id]/route", () => m.passThrough);
vi.mock("@/app/api/admin/client-approvals/[id]/route", () => m.passThrough);
vi.mock("@/app/api/admin/job-tasks/[id]/route", () => m.passThrough);
vi.mock("@/app/api/admin/jobs/[id]/skip/route", () => ({ PATCH: m.skip }));
vi.mock("@/app/api/admin/qa/rework-transfers/[id]/route", () => m.passThrough);
vi.mock("@/app/api/admin/qa/outcomes/route", () => m.passThrough);
vi.mock("@/app/api/admin/qa/issues/[id]/route", () => m.passThrough);

import { POST } from "@/app/api/admin/approvals/bulk/route";

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/admin/approvals/bulk", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  m.role.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.opsAccess.mockResolvedValue(null);
  m.timing.mockImplementation(async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = await req.json();
    return Response.json(params.id === "t2" ? { error: "This request was already decided." } : { id: params.id, ...body }, { status: params.id === "t2" ? 409 : 200 });
  });
  m.skip.mockImplementation(async () => Response.json({ ok: true }));
});

describe("POST /api/admin/approvals/bulk", () => {
  it("answers 401 / 403 from the role guard", async () => {
    m.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await post({ queue: "timingRequests", decision: "approve", ids: ["t1"] })).status).toBe(401);
    m.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await post({ queue: "timingRequests", decision: "approve", ids: ["t1"] })).status).toBe(403);
  });

  it("refuses a malformed body and a decision the queue does not allow in bulk", async () => {
    expect((await post({ queue: "nope", decision: "approve", ids: ["a"] })).status).toBe(400);
    expect((await post({ queue: "timingRequests", decision: "approve", ids: [] })).status).toBe(400);
    const refused = await post({ queue: "payAdjustments", decision: "approve", ids: ["p1"] });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/own amount/);
  });

  it("hands each row to the existing route handler and returns per-row outcomes", async () => {
    const response = await post({ queue: "timingRequests", decision: "approve", ids: ["t1", "t2"] });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(m.timing).toHaveBeenCalledTimes(2);
    const [request, context] = m.timing.mock.calls[0] as [NextRequest, { params: { id: string } }];
    expect(new URL(request.url).pathname).toBe("/api/admin/job-early-checkouts/t1");
    expect(context.params.id).toBe("t1");
    expect(body.outcomes).toEqual([
      { id: "t1", status: "done", message: "Done." },
      { id: "t2", status: "refused", message: "This request was already decided." },
    ]);
  });

  it("refuses rows for an operations manager without the single route's area, without calling it", async () => {
    m.role.mockResolvedValue({ user: { id: "ops", role: "OPS_MANAGER" } });
    m.opsAccess.mockResolvedValue(new Proxy({ jobs: "read" } as Record<string, string>, { get: (target, key: string) => target[key] ?? "manage" }));
    const body = await (await post({ queue: "skipRequests", decision: "approve", ids: ["j1"] })).json();
    expect(m.skip).not.toHaveBeenCalled();
    expect(body.outcomes[0].status).toBe("refused");
  });
});
