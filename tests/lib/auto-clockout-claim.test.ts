// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), aggregate: vi.fn(), claim: vi.fn(), notify: vi.fn(), audit: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { timeLog: { findMany: mocks.find, aggregate: mocks.aggregate }, $transaction: mocks.transaction } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ autoClockOut: { enabled: true } }) }));
vi.mock("@/lib/time/clock-rules", () => ({ resolveClockRuleForLog: () => ({ cutoffAt: new Date("2020-01-01T01:00:00Z") }) }));
import { autoClockOutStaleTimeLogsForUser } from "@/lib/time/auto-clockout";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue([{ id: "log", jobId: "job", startedAt: new Date("2020-01-01"), job: { id: "job", property: { name: "Property" } } }]);
  mocks.aggregate.mockResolvedValue({ _sum: { durationM: 0 } });
  mocks.transaction.mockImplementation(async run => run({ timeLog: { updateMany: mocks.claim }, notification: { create: mocks.notify }, auditLog: { create: mocks.audit } }));
});
it("does not overwrite a clock or produce events after another request closed it", async () => {
  mocks.claim.mockResolvedValue({ count: 0 });
  expect(await autoClockOutStaleTimeLogsForUser("cleaner")).toBe(0);
  expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "log", stoppedAt: null } }));
  expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
});
it("only the successful close produces audit and notification", async () => {
  mocks.claim.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  expect(await Promise.all([autoClockOutStaleTimeLogsForUser("cleaner"), autoClockOutStaleTimeLogsForUser("cleaner")])).toEqual([1, 0]);
  expect(mocks.notify).toHaveBeenCalledTimes(1); expect(mocks.audit).toHaveBeenCalledTimes(1);
});
