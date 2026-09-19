// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { GET } from "@/app/api/cleaner/location/active-job/route";
import { TRACKED_STATUSES } from "@/lib/gps/tracked-statuses";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.session }));
vi.mock("@/lib/db", () => ({ db: { job: { findFirst: mocks.find } } }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: "cleaner-one" } });
  mocks.find.mockResolvedValue(null);
});
describe("cleaner active-job probe", () => {
  it.each(TRACKED_STATUSES)("returns assigned %s work with only strip fields", async status => {
    mocks.find.mockResolvedValue({ id: "job-one", status, property: { name: "Test property" }, timeLogs: [] });
    const response = await GET();
    expect(mocks.session).toHaveBeenCalledWith([Role.CLEANER]);
    expect(mocks.find).toHaveBeenCalledWith({
      where: { status: { in: TRACKED_STATUSES }, assignments: { some: { userId: "cleaner-one", removedAt: null } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, property: { select: { name: true } }, timeLogs: { where: { userId: "cleaner-one", stoppedAt: null }, select: { startedAt: true }, orderBy: { startedAt: "desc" }, take: 1 } },
    });
    expect(await response.json()).toEqual({ job: { id: "job-one", status, property: { name: "Test property" },
      draftIdentity: cleanerDraftIdentity({ user: { id: "cleaner-one" } }, "job-one"), clock: { running: false, startedAt: null }, checkedAt: expect.any(String) } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses only this cleaner's open clock and binds recovery to the real actor", async () => {
    const session = { user: { id: "cleaner-one" }, impersonation: { actorId: "office" } };
    mocks.session.mockResolvedValue(session);
    mocks.find.mockResolvedValue({ id: "job-one", status: "PAUSED", property: { name: "Test property" }, timeLogs: [{ startedAt: new Date("2026-09-01T03:00:00Z") }] });
    expect((await (await GET()).json()).job).toMatchObject({ draftIdentity: cleanerDraftIdentity(session, "job-one"), clock: { running: true, startedAt: "2026-09-01T03:00:00.000Z" } });
  });
  it("distinguishes no active work from a failed query", async () => {
    expect((await GET()).status).toBe(200);
    mocks.find.mockRejectedValue(new Error("private database detail"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ job: null });
  });
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("does not query for %s", async (message, status) => {
    mocks.session.mockRejectedValue(new Error(message as string));
    const response = await GET();
    expect(response.status).toBe(status);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
