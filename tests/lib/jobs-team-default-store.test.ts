// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { publishJobsTeamDefault, readJobsTeamDefault } from "@/lib/jobs/team-default-store";
import { DEFAULT_JOBS_STATE, jobsSnapshot } from "@/lib/jobs/workspace-state";
const mocks = vi.hoisted(() => ({ read: vi.fn(), transaction: vi.fn(), audit: vi.fn(), upsert: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: mocks.read }, $transaction: mocks.transaction } }));
let stored: unknown;
beforeEach(() => {
  vi.resetAllMocks(); stored = undefined;
  mocks.read.mockImplementation(async () => stored === undefined ? null : { value: stored });
  mocks.transaction.mockImplementation(async callback => {
    let staged = stored;
    const result = await callback({ $executeRaw: mocks.lock, appSetting: { findUnique: mocks.read, upsert: async (args: any) => { mocks.upsert(args); staged = args.update.value; } }, auditLog: { create: mocks.audit } });
    stored = staged; return result;
  });
});
it("publishes validated snapshots and records actor in the same transaction", async () => {
  const snapshot = jobsSnapshot({ ...DEFAULT_JOBS_STATE, density: "compact" });
  const result = await publishJobsTeamDefault("owner", { revision: 0, snapshot });
  expect(result).toMatchObject({ revision: 1, snapshot, updatedBy: "owner" });
  expect(mocks.lock).toHaveBeenCalled(); expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "owner", action: "JOBS_TEAM_DEFAULT_PUBLISHED" }) }));
  expect((await readJobsTeamDefault()).snapshot).toEqual(snapshot);
});
it("rejects stale publications and preserves the winning default", async () => {
  const snapshot = jobsSnapshot(DEFAULT_JOBS_STATE);
  await publishJobsTeamDefault("owner", { revision: 0, snapshot });
  await expect(publishJobsTeamDefault("other-admin", { revision: 0, snapshot: null })).rejects.toMatchObject({ status: 409 });
  expect((await readJobsTeamDefault()).snapshot).toEqual(snapshot);
});
it("removes the shared fallback while retaining revision history", async () => {
  await publishJobsTeamDefault("owner", { revision: 0, snapshot: jobsSnapshot(DEFAULT_JOBS_STATE) });
  expect(await publishJobsTeamDefault("owner", { revision: 1, snapshot: null })).toMatchObject({ revision: 2, snapshot: null });
});
it("does not reset invalid stored data", async () => {
  stored = { version: 999 }; await expect(readJobsTeamDefault()).rejects.toMatchObject({ code: "STORAGE_INVALID" });
  await expect(publishJobsTeamDefault("owner", { revision: 0, snapshot: null })).rejects.toMatchObject({ code: "STORAGE_INVALID" });
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it("rejects malformed snapshots before any transaction", async () => {
  await expect(publishJobsTeamDefault("owner", { revision: 0, snapshot: {} })).rejects.toMatchObject({ status: 400 }); expect(mocks.transaction).not.toHaveBeenCalled();
});
it("rolls back if audit recording fails", async () => {
  mocks.audit.mockRejectedValue(new Error("audit failed")); await expect(publishJobsTeamDefault("owner", { revision: 0, snapshot: null })).rejects.toThrow("audit failed"); expect(stored).toBeUndefined();
});

it("returns an optional empty default before any publication", async () => {
  expect(await readJobsTeamDefault()).toMatchObject({ revision: 0, snapshot: null });
});
