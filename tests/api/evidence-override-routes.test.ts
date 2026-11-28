// @vitest-environment node
/** "Camera not working — ask the office" routes: live role, pilot, impersonation, inputs. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ role: vi.fn(), assignment: vi.fn(), job: vi.fn(), pilot: vi.fn(), ask: vi.fn(), decide: vi.fn(), list: vi.fn(), office: vi.fn(), deliver: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.role }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/pilots/gates", () => ({ cleanerJobFlowOn: m.pilot }));
vi.mock("@/lib/notifications/inline-dispatch", () => ({ deliverInboxIntentsNow: m.deliver }));
vi.mock("@/lib/db", () => ({ db: { jobAssignment: { findFirst: m.assignment }, job: { findUnique: m.job } } }));
vi.mock("@/lib/jobs/evidence-override", async () => {
  const { z } = await import("zod");
  class EvidenceOverrideError extends Error {
    constructor(public status: number, message: string, public code: string) {
      super(message);
    }
  }
  return {
    EvidenceOverrideError,
    askEvidenceOverride: m.ask,
    decideEvidenceOverride: async (...args: unknown[]) => {
      const body = args[2] as { reason?: string } | null;
      z.object({ reason: z.string().min(5) }).parse(body ?? {});
      return m.decide(...args);
    },
    listEvidenceOverridesForCleaner: m.list,
    listEvidenceOverridesForOffice: m.office,
  };
});

import { GET as cleanerGet, POST as cleanerPost } from "@/app/api/cleaner/jobs/[id]/evidence-override/route";
import { GET as officeList } from "@/app/api/admin/job-evidence-overrides/route";
import { PATCH as officeDecide } from "@/app/api/admin/job-evidence-overrides/[id]/route";

const params = { params: { id: "job-1" } };
const req = (method: string, body?: unknown, url = "http://local/api/x") => new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const asked = { status: "ALLOWED", allowedFieldIds: ["bench"], id: "r1" };

beforeEach(() => {
  vi.resetAllMocks();
  m.role.mockResolvedValue({ user: { id: "cleaner-1", role: Role.CLEANER } });
  m.assignment.mockResolvedValue({ id: "a1" });
  m.job.mockResolvedValue({ propertyId: "property-1" });
  m.pilot.mockResolvedValue(true);
  m.list.mockResolvedValue([]);
  m.deliver.mockResolvedValue(new Map([["i1", { state: "inbox_available" }]]));
  m.ask.mockResolvedValue({ outcome: "CREATED", request: { id: "r1", status: "REQUESTED" }, intentIds: ["i1"] });
  m.decide.mockResolvedValue({ outcome: "DECIDED", request: { id: "r1", status: "ALLOWED", allowedFieldIds: ["bench"], decidedAt: new Date() }, intentIds: [] });
});

describe("cleaner route", () => {
  it("GET: assigned cleaner only; lists allowed questions even when the pilot is off", async () => {
    m.assignment.mockResolvedValueOnce(null);
    expect((await cleanerGet(req("GET"), params)).status).toBe(403);
    m.pilot.mockResolvedValue(false);
    m.list.mockResolvedValue([asked]);
    const body = await (await cleanerGet(req("GET"), params)).json();
    expect(body).toMatchObject({ canAsk: false, allowedFieldIds: ["bench"], refusal: "Not switched on for this job. Call the office." });
    expect(m.pilot).toHaveBeenCalledWith(expect.anything(), { jobId: "job-1", userId: "cleaner-1", propertyId: "property-1" });
  });

  it("GET: a waiting request means no second ask", async () => {
    m.list.mockResolvedValue([{ status: "REQUESTED", allowedFieldIds: [] }]);
    expect(await (await cleanerGet(req("GET"), params)).json()).toMatchObject({ canAsk: false, refusal: "The office has not answered yet." });
  });

  it("POST: refused while testing as the cleaner and when the pilot is off, before anything is written", async () => {
    m.role.mockResolvedValueOnce({ user: { id: "cleaner-1", role: Role.CLEANER }, impersonation: { actorId: "admin" } });
    expect((await cleanerPost(req("POST", {}), params)).status).toBe(403);
    m.pilot.mockResolvedValue(false);
    const off = await cleanerPost(req("POST", {}), params);
    expect(off.status).toBe(409);
    expect((await off.json()).code).toBe("PILOT_OFF");
    expect(m.ask).not.toHaveBeenCalled();
  });

  it("POST: asks as the actual cleaner and reports the inbox state (queued is not delivered)", async () => {
    const response = await cleanerPost(req("POST", { requestKey: "photos-abcdefgh", note: "Camera broken", fields: [{ fieldId: "bench", label: "Bench" }] }), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ outcome: "CREATED", office: { queued: 1, inInbox: 1 } });
    expect(m.ask).toHaveBeenCalledWith({ id: "cleaner-1", role: Role.CLEANER }, "job-1", expect.objectContaining({ note: "Camera broken" }));
  });
});

describe("office routes", () => {
  it("PATCH: ADMIN or OPS_MANAGER on the live session, decided as their own role", async () => {
    m.role.mockResolvedValue({ user: { id: "ops-1", role: Role.OPS_MANAGER } });
    const response = await officeDecide(req("PATCH", { decision: "ALLOW", allowedFieldIds: ["bench"], reason: "Phone camera broken" }), { params: { id: "r1" } });
    expect(response.status).toBe(200);
    expect(m.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(m.decide).toHaveBeenCalledWith({ id: "ops-1", role: Role.OPS_MANAGER }, "r1", expect.anything());
  });

  it("PATCH: refused while testing as someone, and without a reason", async () => {
    m.role.mockResolvedValueOnce({ user: { id: "admin", role: Role.ADMIN }, impersonation: { actorId: "admin" } });
    expect((await officeDecide(req("PATCH", { decision: "DECLINE", reason: "No reason given" }), { params: { id: "r1" } })).status).toBe(403);
    m.role.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
    expect((await officeDecide(req("PATCH", { decision: "DECLINE" }), { params: { id: "r1" } })).status).toBe(400);
    expect(m.decide).not.toHaveBeenCalled();
  });

  it("PATCH: a cleaner (or anyone the live guard refuses) gets 403", async () => {
    m.role.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await officeDecide(req("PATCH", { decision: "DECLINE", reason: "x".repeat(6) }), { params: { id: "r1" } })).status).toBe(403);
  });

  it("GET list: needs a job id", async () => {
    m.role.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
    expect((await officeList(req("GET", undefined, "http://local/api/admin/job-evidence-overrides"))).status).toBe(400);
    m.office.mockResolvedValue([]);
    expect(await (await officeList(req("GET", undefined, "http://local/api/admin/job-evidence-overrides?jobId=job-1"))).json()).toMatchObject({ jobId: "job-1", requests: [] });
  });

  it("the paths map to the Approvals pack (manage to decide, read to list)", async () => {
    const { allOpsLevels, canUseOpsPath } = await import("@/lib/rbac/ops-catalog");
    const levels = (approvals: "off" | "read" | "manage") => ({ ...allOpsLevels("manage"), approvals });
    expect(canUseOpsPath(levels("manage"), "/api/admin/job-evidence-overrides/r1", "PATCH")).toBe(true);
    expect(canUseOpsPath(levels("read"), "/api/admin/job-evidence-overrides/r1", "PATCH")).toBe(false);
    expect(canUseOpsPath(levels("read"), "/api/admin/job-evidence-overrides", "GET")).toBe(true);
    expect(canUseOpsPath(levels("off"), "/api/admin/job-evidence-overrides", "GET")).toBe(false);
  });
});
