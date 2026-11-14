// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * New job routes: the create route's request key and choices, and the
 * read-only preview routes' live session/role guard and query checks.
 */
const m = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createOnce: vi.fn(),
  createWith: vi.fn(),
  findJob: vi.fn(),
  options: vi.fn(),
  facts: vi.fn(),
  day: vi.fn(),
  findSources: vi.fn(),
  loadSource: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.findJob } } }));
vi.mock("@/lib/jobs/admin-create", async (orig) => ({
  ...(await orig<typeof import("@/lib/jobs/admin-create")>()),
  createAdminJobOnce: m.createOnce,
  createAdminJobWithFollowUps: m.createWith,
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/jobs/new-job/options", () => ({ loadNewJobOptions: m.options }));
vi.mock("@/lib/jobs/new-job/property-facts", () => ({ loadNewJobPropertyFacts: m.facts }));
vi.mock("@/lib/jobs/new-job/day-check", () => ({ loadNewJobDayCheck: m.day }));
vi.mock("@/lib/jobs/new-job/duplicate-source", () => ({ findDuplicateSources: m.findSources, loadDuplicateSource: m.loadSource }));

import { POST as createJob } from "@/app/api/admin/jobs/route";
import { GET as getOptions } from "@/app/api/admin/jobs/new-job/options/route";
import { GET as getProperty } from "@/app/api/admin/jobs/new-job/property/route";
import { GET as getDay } from "@/app/api/admin/jobs/new-job/day/route";
import { GET as getDuplicate } from "@/app/api/admin/jobs/new-job/duplicate/route";

const session = { user: { id: "ops-1", name: "Ops", role: "OPS_MANAGER" } };
const body = { propertyId: "p1", jobType: "AIRBNB_TURNOVER", scheduledDate: "2026-11-20T00:00:00.000Z", startTime: "10:00", dueTime: "15:00" };
const post = (data: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/admin/jobs", { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json", ...headers } });
const get = (path: string) => new NextRequest(`http://localhost${path}`);

beforeEach(() => {
  vi.resetAllMocks();
  m.requireRole.mockResolvedValue(session);
  m.createWith.mockResolvedValue({ job: { id: "job-1", jobNumber: "J-1" }, followUps: { carryForwardAttached: 0 } });
  m.createOnce.mockResolvedValue({ jobId: "job-1", jobNumber: "J-1", replayed: false, followUps: { carryForwardAttached: 0 } });
  m.findJob.mockResolvedValue({ id: "job-1", jobNumber: "J-1" });
});

describe("POST /api/admin/jobs", () => {
  it("without a request key keeps the old path (201, the job, plus what the follow-ups did)", async () => {
    const response = await createJob(post(body));
    expect(response.status).toBe(201);
    expect(m.createWith).toHaveBeenCalledWith(expect.objectContaining({ propertyId: "p1" }), expect.objectContaining({ actor: { userId: "ops-1", name: "Ops" } }));
    expect(m.createOnce).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ id: "job-1", followUps: { carryForwardAttached: 0 } });
  });

  it("with a request key creates once per person and key, passing the choices", async () => {
    const response = await createJob(post({ ...body, skipPreferredCleaner: true, sendBookingConfirmation: false }, { "Idempotency-Key": "272bdb5b-2665-433c-a440" }));
    expect(response.status).toBe(201);
    const [, receipt, options] = m.createOnce.mock.calls[0];
    expect(receipt).toMatchObject({ key: "new-job:ops-1:272bdb5b-2665-433c-a440", userId: "ops-1", action: "JOB_CREATE_REQUEST", entity: "JobCreateRequest" });
    expect(receipt.detail.bodyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(options).toMatchObject({ skipPreferredCleaner: true, sendBookingConfirmation: false });
  });

  it("a replay answers 200 with replayed: true", async () => {
    m.createOnce.mockResolvedValue({ jobId: "job-1", jobNumber: "J-1", replayed: true });
    const response = await createJob(post(body, { "Idempotency-Key": "272bdb5b-2665-433c-a440" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, followUps: null });
  });

  it("refuses a malformed key and a refused role", async () => {
    expect((await createJob(post(body, { "Idempotency-Key": "x" }))).status).toBe(400);
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await createJob(post(body, { "Idempotency-Key": "272bdb5b-2665-433c-a440" }))).status).toBe(403);
    expect(m.createOnce).not.toHaveBeenCalled();
  });
});

describe("preview routes are guarded by the live session and only read", () => {
  it.each([
    ["options", () => getOptions()],
    ["property", () => getProperty(get("/api/admin/jobs/new-job/property?propertyId=p1&jobType=AIRBNB_TURNOVER"))],
    ["day", () => getDay(get("/api/admin/jobs/new-job/day?propertyId=p1&jobType=AIRBNB_TURNOVER&dates=2026-11-20"))],
    ["duplicate", () => getDuplicate(get("/api/admin/jobs/new-job/duplicate?q=J-1"))],
  ])("%s answers 401/403 from the guard and calls the guard with ADMIN and OPS_MANAGER", async (_name, call) => {
    m.requireRole.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await call()).status).toBe(401);
    m.requireRole.mockRejectedValueOnce(new Error("FORBIDDEN"));
    expect((await call()).status).toBe(403);
    expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
    expect(m.options).not.toHaveBeenCalled();
    expect(m.facts).not.toHaveBeenCalled();
    expect(m.day).not.toHaveBeenCalled();
  });

  it("day: validates dates and passes the organisation timezone; 404 for an unknown property", async () => {
    expect((await getDay(get("/api/admin/jobs/new-job/day?propertyId=p1&jobType=AIRBNB_TURNOVER&dates=2026-13-45"))).status).toBe(400);
    expect((await getDay(get("/api/admin/jobs/new-job/day?propertyId=p1&jobType=NOPE&dates=2026-11-20"))).status).toBe(400);
    const many = Array.from({ length: 32 }, (_, i) => `2026-12-${String(i + 1).padStart(2, "0")}`).join(",");
    expect((await getDay(get(`/api/admin/jobs/new-job/day?propertyId=p1&jobType=AIRBNB_TURNOVER&dates=${many}`))).status).toBe(400);
    m.day.mockResolvedValue(null);
    expect((await getDay(get("/api/admin/jobs/new-job/day?propertyId=nope&jobType=AIRBNB_TURNOVER&dates=2026-11-23,2026-11-20,2026-11-20&suggest=1"))).status).toBe(404);
    expect(m.day).toHaveBeenCalledWith(expect.objectContaining({ dayKeys: ["2026-11-20", "2026-11-23"], suggest: true, timezone: "Australia/Sydney", startTime: null }));
  });

  it("property: 404 for an unknown property, never cached", async () => {
    m.facts.mockResolvedValue(null);
    const response = await getProperty(get("/api/admin/jobs/new-job/property?propertyId=nope&jobType=AIRBNB_TURNOVER"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
