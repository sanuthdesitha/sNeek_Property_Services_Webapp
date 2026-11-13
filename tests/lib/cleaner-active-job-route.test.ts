// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { GET } from "@/app/api/cleaner/location/active-job/route";
import { TRACKED_STATUSES } from "@/lib/gps/tracked-statuses";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), findUnique: vi.fn(), window: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { job: { findFirst: mocks.find, findUnique: mocks.findUnique } } }));
vi.mock("@/lib/gps/tracking-window", () => ({
  TRACKING_REFUSAL_TEXT: { NO_ACTIVE_JOB: "No job", IMPERSONATING: "Viewing as", CLOCK_STOPPED: "Clock stopped" },
  resolveActiveCleanerWindow: mocks.window,
}));
const STRIP_SELECT = { id: true, status: true, property: { select: { name: true } }, timeLogs: { where: { userId: "cleaner-one", stoppedAt: null }, select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "cleaner-one" } });
  mocks.find.mockResolvedValue(null);
  mocks.window.mockResolvedValue({ ok: false, reason: "NO_ACTIVE_JOB" });
});
describe("cleaner active-job probe", () => {
  it.each(TRACKED_STATUSES)("returns assigned %s work for the strip, limited to today's or still-running work", async status => {
    mocks.find.mockResolvedValue({ id: "job-one", status, property: { name: "Test property" }, timeLogs: [] });
    const response = await GET();
    expect(mocks.session).toHaveBeenCalledWith([Role.CLEANER]);
    const query = mocks.find.mock.calls[0][0];
    expect(query.where).toMatchObject({ status: { in: TRACKED_STATUSES }, assignments: { some: { userId: "cleaner-one", removedAt: null } } });
    // Live location 2026-11: an old paused job is no longer picked up for days.
    expect(query.where.OR).toEqual([{ scheduledDate: { gte: expect.any(Date) } }, { timeLogs: { some: { userId: "cleaner-one", stoppedAt: null } } }]);
    expect(query.select).toEqual(STRIP_SELECT);
    expect(await response.json()).toEqual({
      job: { id: "job-one", status, property: { name: "Test property" },
        draftIdentity: cleanerDraftIdentity({ user: { id: "cleaner-one" } }, "job-one"), clock: { running: false, startedAt: null }, checkedAt: expect.any(String) },
      tracking: { active: false, reason: "NO_ACTIVE_JOB", message: "No job" },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("tracks only inside the server's window, and says whether the client can see the cleaner", async () => {
    mocks.window.mockResolvedValue({ ok: true, source: "CLEANER_DRIVING", job: { id: "job-one", status: "EN_ROUTE", clientShowsLiveLocation: true } });
    mocks.findUnique.mockResolvedValue({ id: "job-one", status: "EN_ROUTE", property: { name: "Test property" }, timeLogs: [] });
    const body = await (await GET()).json();
    expect(body.tracking).toEqual({ active: true, jobId: "job-one", clientSees: true });
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("does not track a paused job with no running clock, and never while impersonated", async () => {
    mocks.window.mockResolvedValue({ ok: false, reason: "CLOCK_STOPPED" });
    mocks.find.mockResolvedValue({ id: "job-one", status: "PAUSED", property: { name: "Test property" }, timeLogs: [] });
    expect((await (await GET()).json()).tracking).toMatchObject({ active: false, reason: "CLOCK_STOPPED" });
    const session = { user: { id: "cleaner-one" }, impersonation: { actorId: "office" } };
    mocks.session.mockResolvedValue(session);
    mocks.window.mockResolvedValue({ ok: false, reason: "IMPERSONATING" });
    await GET();
    expect(mocks.window).toHaveBeenLastCalledWith(expect.objectContaining({ impersonating: true }));
  });
  it("uses only this cleaner's open clock and binds recovery to the real actor", async () => {
    const session = { user: { id: "cleaner-one" }, impersonation: { actorId: "office" } };
    mocks.session.mockResolvedValue(session);
    mocks.find.mockResolvedValue({ id: "job-one", status: "PAUSED", property: { name: "Test property" }, timeLogs: [{ startedAt: new Date("2026-09-01T03:00:00Z") }] });
    expect((await (await GET()).json()).job).toMatchObject({ draftIdentity: cleanerDraftIdentity(session, "job-one"), clock: { running: true, startedAt: "2026-09-01T03:00:00.000Z" } });
  });
  it("distinguishes no active work from a failed query, and stops tracking on failure", async () => {
    expect((await GET()).status).toBe(200);
    mocks.find.mockRejectedValue(new Error("private database detail"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ job: null, tracking: { active: false } });
  });
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("does not query for %s", async (message, status) => {
    mocks.session.mockRejectedValue(new Error(message as string));
    const response = await GET();
    expect(response.status).toBe(status);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
