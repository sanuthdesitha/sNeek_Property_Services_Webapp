// @vitest-environment node
/**
 * "Looks unused — ask the office" routes (2026-11-28): live session and role
 * guards on every call, the cleaner must hold an assignment, an administrator
 * testing as someone is refused on both sides, and the office answer records
 * the role the person answered as (ADMIN and OPS_MANAGER are kept apart).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  role: vi.fn(),
  ask: vi.fn(),
  answer: vi.fn(),
  list: vi.fn(),
  deliver: vi.fn(),
  assignment: vi.fn(),
  job: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/notifications/inline-dispatch", () => ({ deliverInboxIntentsNow: mocks.deliver }));
vi.mock("@/lib/db", () => ({ db: { jobAssignment: { findFirst: mocks.assignment }, job: { findUnique: mocks.job } } }));
vi.mock("@/lib/jobs/unused-check", () => {
  class UnusedCheckError extends Error {
    constructor(public status: number, message: string, public code: string) {
      super(message);
    }
  }
  return { askUnusedCheck: mocks.ask, answerUnusedCheck: mocks.answer, listUnusedChecksForCleaner: mocks.list, UnusedCheckError };
});

import { GET as cleanerGet, POST as cleanerPost } from "@/app/api/cleaner/jobs/[id]/unused-check/route";
import { PATCH as officeAnswer } from "@/app/api/admin/job-unused-checks/[id]/route";
import { UnusedCheckError } from "@/lib/jobs/unused-check";

const params = { params: { id: "job-1" } };
const cleanerSession = { user: { id: "cleaner-1", role: Role.CLEANER } };

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/x", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

const waiting = { id: "check-1", jobId: "job-1", status: "WAITING", note: null, photoCount: 0, askedAt: "2026-11-28T00:00:00.000Z", askedByMe: true, decision: null, decisionNote: null, answeredAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role.mockResolvedValue(cleanerSession);
  mocks.assignment.mockResolvedValue({ responseStatus: "ACCEPTED" });
  mocks.job.mockResolvedValue({ status: "IN_PROGRESS", jobType: "AIRBNB_TURNOVER" });
  mocks.list.mockResolvedValue([]);
  mocks.deliver.mockResolvedValue(new Map([["intent-1", { state: "inbox_available" }]]));
});

describe("cleaner: GET and POST /api/cleaner/jobs/[id]/unused-check", () => {
  it("guards with the live CLEANER role and answers 401/403 from it", async () => {
    mocks.role.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await cleanerGet(request("GET"), params)).status).toBe(401);
    mocks.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await cleanerPost(request("POST", {}), params)).status).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith([Role.CLEANER]);
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("refuses a cleaner with no assignment on this job", async () => {
    mocks.assignment.mockResolvedValue(null);
    const response = await cleanerGet(request("GET"), params);
    expect(response.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("offers asking on an open Airbnb turnover, and says why not otherwise", async () => {
    const open = await (await cleanerGet(request("GET"), params)).json();
    expect(open).toMatchObject({ jobId: "job-1", canAsk: true, refusal: null });
    mocks.list.mockResolvedValue([waiting]);
    expect(await (await cleanerGet(request("GET"), params)).json()).toMatchObject({ canAsk: false, refusal: "The office has not answered yet." });
    mocks.list.mockResolvedValue([]);
    mocks.job.mockResolvedValue({ status: "IN_PROGRESS", jobType: "GENERAL_CLEAN" });
    expect(await (await cleanerGet(request("GET"), params)).json()).toMatchObject({ canAsk: false, refusal: expect.stringContaining("Airbnb") });
  });

  it("refuses an administrator testing as the cleaner, on read (no ask offered) and on write", async () => {
    mocks.role.mockResolvedValue({ ...cleanerSession, impersonation: { actorId: "admin-1", mode: "FULL" } });
    expect(await (await cleanerGet(request("GET"), params)).json()).toMatchObject({ canAsk: false, refusal: "Only the cleaner can ask the office." });
    const response = await cleanerPost(request("POST", { requestKey: "unused-abcdefgh" }), params);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("IMPERSONATION_NOT_ALLOWED");
    expect(mocks.ask).not.toHaveBeenCalled();
  });

  it("asks as the signed-in cleaner, puts the office notices in the inbox now and reports only what is in an inbox", async () => {
    mocks.ask.mockResolvedValue({ outcome: "CREATED", check: { id: "check-1" }, intentIds: ["intent-1", "intent-2"] });
    mocks.deliver.mockResolvedValue(new Map([["intent-1", { state: "inbox_available" }], ["intent-2", { state: "queued" }]]));
    mocks.list.mockResolvedValue([waiting]);
    const response = await cleanerPost(request("POST", { requestKey: "unused-abcdefgh", note: "Beds untouched" }), params);
    expect(response.status).toBe(201);
    expect(mocks.ask).toHaveBeenCalledWith({ id: "cleaner-1", role: Role.CLEANER }, "job-1", { requestKey: "unused-abcdefgh", note: "Beds untouched" });
    expect(await response.json()).toMatchObject({ outcome: "CREATED", checkId: "check-1", checks: [waiting], office: { queued: 2, inInbox: 1 } });
  });

  it("answers a replay with 200 and dispatches nothing again", async () => {
    mocks.ask.mockResolvedValue({ outcome: "REPLAYED", check: { id: "check-1" }, intentIds: [] });
    const response = await cleanerPost(request("POST", { requestKey: "unused-abcdefgh" }), params);
    expect(response.status).toBe(200);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("passes a domain refusal through with its status and code, and keeps the note on failure", async () => {
    mocks.ask.mockRejectedValue(new UnusedCheckError(409, "Only Airbnb turnovers can be checked with the office this way.", "NOT_ELIGIBLE"));
    const refused = await cleanerPost(request("POST", { requestKey: "unused-abcdefgh" }), params);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "NOT_ELIGIBLE" });
    mocks.ask.mockRejectedValue(new Error("connection lost"));
    const failed = await cleanerPost(request("POST", { requestKey: "unused-abcdefgh" }), params);
    expect(failed.status).toBe(500);
    expect((await failed.json()).error).toMatch(/note is kept/i);
  });
});

describe("office: PATCH /api/admin/job-unused-checks/[id]", () => {
  const answerParams = { params: { id: "check-1" } };
  const decided = { outcome: "ANSWERED", check: { id: "check-1", decision: "LIGHT_REFRESH", decidedAt: new Date("2026-11-28T01:00:00Z") }, intentIds: ["intent-1"] };

  it("allows only ADMIN and OPS_MANAGER on the live session", async () => {
    mocks.role.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const response = await officeAnswer(request("PATCH", { decision: "CLEAN_AS_NORMAL" }), answerParams);
    expect(response.status).toBe(403);
    expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("records the role answered as, keeping ADMIN and OPS_MANAGER apart", async () => {
    mocks.answer.mockResolvedValue(decided);
    mocks.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    await officeAnswer(request("PATCH", { decision: "LIGHT_REFRESH" }), answerParams);
    expect(mocks.answer).toHaveBeenLastCalledWith({ id: "ops-1", role: Role.OPS_MANAGER }, "check-1", { decision: "LIGHT_REFRESH" });
    mocks.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
    const response = await officeAnswer(request("PATCH", { decision: "LIGHT_REFRESH" }), answerParams);
    expect(mocks.answer).toHaveBeenLastCalledWith({ id: "admin-1", role: Role.ADMIN }, "check-1", { decision: "LIGHT_REFRESH" });
    expect(await response.json()).toMatchObject({ outcome: "ANSWERED", decision: "LIGHT_REFRESH", cleaners: { queued: 1, inInbox: 1 } });
  });

  it("refuses an administrator testing as another person", async () => {
    mocks.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER }, impersonation: { actorId: "admin-1", mode: "FULL" } });
    const response = await officeAnswer(request("PATCH", { decision: "DO_NOT_CLEAN" }), answerParams);
    expect(response.status).toBe(403);
    expect(mocks.answer).not.toHaveBeenCalled();
  });

  it("passes an already-answered refusal through", async () => {
    mocks.role.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
    mocks.answer.mockRejectedValue(new UnusedCheckError(409, "This question was already answered. Reload to see the answer.", "ALREADY_ANSWERED"));
    const response = await officeAnswer(request("PATCH", { decision: "DO_NOT_CLEAN" }), answerParams);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ALREADY_ANSWERED");
  });
});

describe("operations packs on the answer and queue paths (live, via requireRole → enforceOpsRequest)", () => {
  it("needs the Approvals pack at manage to answer, read to see the queue; other packs do not help", async () => {
    const { allOpsLevels, canUseOpsPath } = await import("@/lib/rbac/ops-catalog");
    const answerPath = "/api/admin/job-unused-checks/check-1";
    const withApprovals = (level: "off" | "read" | "manage") => ({ ...allOpsLevels("manage"), approvals: level });
    expect(canUseOpsPath(withApprovals("manage"), answerPath, "PATCH")).toBe(true);
    expect(canUseOpsPath(withApprovals("read"), answerPath, "PATCH")).toBe(false);
    expect(canUseOpsPath(withApprovals("off"), answerPath, "PATCH")).toBe(false);
    expect(canUseOpsPath(withApprovals("read"), "/api/admin/all-approvals", "GET")).toBe(true);
    expect(canUseOpsPath(withApprovals("off"), "/api/admin/all-approvals", "GET")).toBe(false);
  });
});
