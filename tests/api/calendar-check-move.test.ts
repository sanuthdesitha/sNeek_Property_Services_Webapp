// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  job: vi.fn(),
  userFirst: vi.fn(),
  users: vi.fn(),
  sameDay: vi.fn(),
  availability: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({
  db: {
    job: { findUnique: m.job },
    user: { findFirst: m.userFirst, findMany: m.users },
    jobAssignment: { findMany: m.sameDay },
    $transaction: vi.fn(() => { throw new Error("no writes expected in this test"); }),
  },
}));
vi.mock("@/lib/accounts/availability", () => ({ listCleanerAvailabilities: m.availability }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn() }));
vi.mock("@/lib/phase4/notification-rules", () => ({ resolveNotificationRuleRecipients: vi.fn() }));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingAdminTasksToJob: vi.fn() }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: vi.fn(), previewLifecycleEmail: vi.fn() }));

import { POST as checkMove } from "@/app/api/admin/calendar/check-move/route";
import { POST as assign } from "@/app/api/admin/jobs/[id]/assign/route";
import { applyReschedule } from "@/lib/phase4/analytics";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

type JobFixture = Record<string, unknown>;
let job: JobFixture;

function fixture(overrides: JobFixture = {}): JobFixture {
  return {
    id: "j1", propertyId: "p1", jobNumber: "J-1", status: "ASSIGNED", jobType: "AIRBNB_TURNOVER",
    scheduledDate: new Date("2026-11-11T00:00:00.000Z"), startTime: "10:00", endTime: null, dueTime: "14:00", estimatedHours: null,
    cleanSkipStatus: "NONE", internalNotes: null, reservationId: null, updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    property: { name: "Bondi Studio", suburb: "Bondi", clientId: "c1", cleanerServiceRate: null },
    assignments: [{ id: "a1", userId: "u1", isPrimary: true, removedAt: null, responseStatus: "ACCEPTED", user: { name: "Jane C.", email: "jane@x" } }],
    ...overrides,
  };
}

const check = (body: Record<string, unknown>) =>
  checkMove(new NextRequest("http://local/api/admin/calendar/check-move", { method: "POST", body: JSON.stringify(body) }));
const assignPost = (userIds: string[]) =>
  assign(new NextRequest("http://local", { method: "POST", body: JSON.stringify({ userIds }) }), { params: { id: "j1" } });

beforeEach(() => {
  vi.resetAllMocks();
  job = fixture();
  m.auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
  m.job.mockImplementation(async () => job);
  m.userFirst.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === "u2" ? { id: "u2", name: "Aiko T.", email: "aiko@x" } : null));
  m.users.mockResolvedValue([]);
  m.sameDay.mockResolvedValue([]);
  m.availability.mockResolvedValue([]);
});

describe("POST /api/admin/calendar/check-move", () => {
  it("requires ADMIN or OPS_MANAGER", async () => {
    m.auth.mockRejectedValue(new Error("FORBIDDEN"));
    expect((await check({ jobId: "j1", toDate: "2026-11-13" })).status).toBe(403);
    expect(m.job).not.toHaveBeenCalled();
  });

  it("refuses malformed input and unknown jobs", async () => {
    expect((await check({ jobId: "j1" })).status).toBe(400);
    expect((await check({ jobId: "j1", toDate: "13/11/2026" })).status).toBe(400);
    job = null as unknown as JobFixture;
    expect((await check({ jobId: "j1", toDate: "2026-11-13" })).status).toBe(404);
  });

  it("plans a date move with the stale-write guard and reports the cleaner's clash on the new day", async () => {
    m.sameDay.mockResolvedValue([{ userId: "u1", job: { id: "other", startTime: "11:00", endTime: null, dueTime: "13:00", estimatedHours: null, property: { name: "Coogee Terrace" } } }]);
    const body = await (await check({ jobId: "j1", toDate: "2026-11-13" })).json();
    expect(body.blockers).toEqual([]);
    expect(body.plan).toEqual({ reschedule: { date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, assign: null });
    expect(body.warnings).toContainEqual({ kind: "clash", text: "Jane C.: Clashes with Coogee Terrace until 13:00" });
    expect(m.sameDay.mock.calls[0][0].where.job.scheduledDate).toEqual({ gte: new Date("2026-11-13T00:00:00.000Z"), lt: new Date("2026-11-14T00:00:00.000Z") });
  });

  it("plans a reassignment that replaces the dragged-from cleaner and reports roster gaps", async () => {
    m.availability.mockResolvedValue([{ userId: "u2", mode: "FIXED", weekly: { "1": [{ start: "08:00", end: "16:00" }] }, dateOverrides: {}, notes: null, updatedAt: "" }]);
    const body = await (await check({ jobId: "j1", toDate: "2026-11-11", fromCleanerId: "u1", toCleanerId: "u2" })).json();
    expect(body.blockers).toEqual([]);
    expect(body.toCleanerName).toBe("Aiko T.");
    expect(body.plan).toEqual({ reschedule: null, assign: { userIds: ["u2"], primaryUserId: "u2" } });
    expect(body.warnings).toContainEqual({ kind: "unavailable", text: "Aiko T.: Not available on Wednesdays" });
  });

  it("notes the booking rule for a reservation-driven turnover", async () => {
    job = fixture({ reservationId: "r1" });
    const body = await (await check({ jobId: "j1", toDate: "2026-11-12" })).json();
    expect(body.warnings.find((warning: { kind: string }) => warning.kind === "booking").text).toMatch(/will not move the job back or create a second job/);
  });

  it.each(["IN_PROGRESS", "SUBMITTED", "COMPLETED", "INVOICED"])("refuses to move a %s job and plans nothing", async (status) => {
    job = fixture({ status });
    const body = await (await check({ jobId: "j1", toDate: "2026-11-12" })).json();
    expect(body.blockers[0]).toMatch(/cannot be moved from the calendar/);
    expect(body.plan.assign).toBeNull();
  });

  it("agrees with the assign route: draft, skipped and non-cleaner accounts are refused by both", async () => {
    job = fixture({ internalNotes: serializeJobInternalNotes({ isDraft: true }) });
    expect((await (await check({ jobId: "j1", toDate: "2026-11-11", toCleanerId: "u2" })).json()).blockers.length).toBeGreaterThan(0);
    expect((await assignPost(["u2"])).status).toBe(409);

    job = fixture({ cleanSkipStatus: "SKIPPED" });
    expect((await (await check({ jobId: "j1", toDate: "2026-11-11", toCleanerId: "u2" })).json()).blockers.join(" ")).toMatch(/skipped/);
    expect((await assignPost(["u2"])).status).toBe(400);

    job = fixture();
    m.users.mockResolvedValue([]); // the assign route finds no active cleaner with that id
    expect((await (await check({ jobId: "j1", toDate: "2026-11-11", toCleanerId: "ghost" })).json()).blockers.join(" ")).toMatch(/Only active cleaners/);
    expect((await assignPost(["ghost"])).status).toBe(400);
  });

  it("agrees with the reschedule service on an impossible start/finish window", async () => {
    job = fixture({ startTime: "15:00", dueTime: "11:00" });
    const body = await (await check({ jobId: "j1", toDate: "2026-11-12" })).json();
    expect(body.blockers.join(" ")).toMatch(/Enter a valid start and finish window\./);
    await expect(applyReschedule({ jobId: "j1", date: "2026-11-12", userId: "admin" })).rejects.toThrow("Enter a valid start and finish window.");
  });

  it("says when nothing would change", async () => {
    const body = await (await check({ jobId: "j1", toDate: "2026-11-11", fromCleanerId: "u1", toCleanerId: "u1" })).json();
    expect(body.blockers[0]).toMatch(/Nothing would change/);
  });
});
