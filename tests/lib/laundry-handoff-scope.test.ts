import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { fetchLaundryWeekTasks, withHandoffActorNames } from "@/lib/laundry/week-feed";
const mocks = vi.hoisted(() => ({ tasks: vi.fn(), users: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { laundryTask: { findMany: mocks.tasks }, user: { findMany: mocks.users } } }));
beforeEach(() => { vi.resetAllMocks(); mocks.users.mockResolvedValue([{ id: "actor-1", name: "Alex" }]); });
describe("laundry receipt actor projection", () => {
  it("looks up only actors on currently visible tasks and includes no profile fields", async () => {
    const task = (id: string, team: string, actor: string) => ({ id, property: { laundryEnabled: true, accessInfo: { laundryTeamUserIds: [team] } }, confirmations: [{ confirmedById: actor, notes: "original notes", createdAt: new Date() }] });
    mocks.tasks.mockResolvedValue([task("visible", "worker-1", "actor-1"), task("denied", "worker-2", "secret-actor")]);
    const rows = await fetchLaundryWeekTasks(new Date(), new Date(), { role: Role.LAUNDRY, userId: "worker-1" });
    expect(rows.map(row => row.id)).toEqual(["visible"]);
    expect(mocks.users).toHaveBeenCalledWith({ where: { id: { in: ["actor-1"] } }, select: { id: true, name: true } });
    expect(rows[0].confirmations[0]).toMatchObject({ confirmedByName: "Alex", notes: "original notes" });
  });
  it("does not query users for no visible confirmations; deleted actors remain unknown", async () => {
    expect(await withHandoffActorNames([])).toEqual([]);
    expect(mocks.users).not.toHaveBeenCalled();
    const rows = await withHandoffActorNames([{ confirmations: [{ confirmedById: "deleted" }] }]);
    expect(rows[0].confirmations[0].confirmedByName).toBeNull();
  });
  it("deduplicates actors and bounds each lookup to 200 IDs", async () => {
    mocks.users.mockResolvedValue([]);
    await withHandoffActorNames([{ confirmations: [...Array.from({ length: 201 }, (_, i) => ({ confirmedById: String(i) })), { confirmedById: "0" }] }]);
    expect(mocks.users.mock.calls.map(([args]) => args.where.id.in.length)).toEqual([200, 1]);
  });
});
