// @vitest-environment node
/**
 * Owner decision (third set item 5): declining a continuation request needs a
 * reason, which the cleaner sees in the decision notification. Approve keeps
 * working without one.
 */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), decide: vi.fn(), audit: vi.fn(), notice: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { auditLog: { create: m.audit }, notification: { create: m.notice } } }));
vi.mock("@/lib/jobs/continuation-requests", () => ({ getContinuationRequestById: m.get, decideContinuationRequest: m.decide }));

import { PATCH } from "@/app/api/admin/job-continuations/[id]/route";

const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/admin/job-continuations/c1", { method: "PATCH", body: JSON.stringify(body) }), { params: { id: "c1" } });

beforeEach(() => {
  vi.resetAllMocks();
  m.auth.mockResolvedValue({ user: { id: "ops-1", role: "OPS_MANAGER" } });
  m.get.mockResolvedValue({ id: "c1", status: "PENDING" });
  m.decide.mockImplementation(async (input: { decision: string; decisionNote: string | null }) => ({
    id: "c1", jobId: "job-1", requestedByUserId: "cleaner-1", status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", decisionNote: input.decisionNote, continuationJobId: "job-2",
  }));
});

it("refuses a decline without a reason (400) and changes nothing", async () => {
  for (const body of [{ decision: "REJECT" }, { decision: "REJECT", decisionNote: "   " }, { decision: "REJECT", decisionNote: null }]) {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/reason is required/i);
  }
  expect(m.decide).not.toHaveBeenCalled();
  expect(m.notice).not.toHaveBeenCalled();
});

it("passes the reason through and the cleaner's notification carries it", async () => {
  const response = await patch({ decision: "REJECT", decisionNote: "Please finish today; the guest arrives at 3." });
  expect(response.status).toBe(200);
  expect(m.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: "REJECT", decisionNote: "Please finish today; the guest arrives at 3." }));
  expect(m.notice).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "cleaner-1", subject: "Continuation request declined", body: "Please finish today; the guest arrives at 3." }) });
});

it("approves without a reason, as before", async () => {
  const response = await patch({ decision: "APPROVE", newScheduledDate: "2026-11-12" });
  expect(response.status).toBe(200);
  expect(m.decide).toHaveBeenCalledWith(expect.objectContaining({ decision: "APPROVE", decisionNote: null }));
});
