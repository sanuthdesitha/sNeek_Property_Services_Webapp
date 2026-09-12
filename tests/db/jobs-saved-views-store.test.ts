// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";

const boundary = vi.hoisted(() => ({ transaction: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: boundary.transaction, appSetting: { findUnique: boundary.read } } }));
import { mutateJobsViews, readJobsViews } from "@/lib/jobs/saved-views-store";
import { DEFAULT_JOBS_STATE, jobsSnapshot } from "@/lib/jobs/workspace-state";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let prisma: PrismaClient | undefined;
const ownedKeys: string[] = [];
function owner() {
  const id = `qa-jobs-views-${randomUUID()}`;
  ownedKeys.push(`admin_jobs_views_v1:${id}`);
  return id;
}

// Execute real store SQL inside one outer rollback transaction. This verifies
// JSON round trips and validation, not concurrent independent transactions.
async function rollback(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  const finished = new Error("QA_ROLLBACK_JOBS_VIEWS");
  if (!prisma) throw new Error("Explicit local test database required");
  try {
    await prisma.$transaction(async tx => {
      boundary.transaction.mockImplementation(async (work, options) => {
        expect(options).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        return work(tx);
      });
      boundary.read.mockImplementation(args => tx.appSetting.findUnique(args));
      await run(tx);
      throw finished;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });
  } catch (error) { if (error !== finished) throw error; }
  finally { boundary.transaction.mockReset(); boundary.read.mockReset(); }
}

describe.skipIf(!url)("Jobs personal view store (explicit local PostgreSQL, rollback only)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!/^postgres(ql)?:$/.test(parsed.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
      || [...parsed.searchParams.keys()].some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) {
      throw new Error("SNEEK_TEST_DATABASE_URL must identify local PostgreSQL");
    }
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
  });
  afterAll(async () => {
    if (!prisma) return;
    try { expect(await prisma.appSetting.count({ where: { key: { in: ownedKeys } } })).toBe(0); }
    finally { await prisma.$disconnect(); }
  });

  it("roundtrips named views/defaults/density without touching another owner's snapshot", async () => {
    const a = owner(), b = owner();
    await rollback(async () => {
      expect((await readJobsViews(a)).views).toEqual([]);
      const snapshot = jobsSnapshot({ ...DEFAULT_JOBS_STATE, density: "compact", dateScope: "today", page: 9 });
      const first = await mutateJobsViews(a, { revision: 0, change: { action: "create", name: "Today", snapshot } });
      expect(first.revision).toBe(1);
      expect(first.views[0].snapshot).not.toHaveProperty("page");
      const other = await mutateJobsViews(b, { revision: 0, change: { action: "create", name: "Other", snapshot } });
      const id = first.views[0].id;
      await mutateJobsViews(a, { revision: 1, change: { action: "default", id } });
      await mutateJobsViews(a, { revision: 2, change: { action: "rename", id, name: "My shift" } });
      await mutateJobsViews(a, { revision: 3, change: { action: "update", id, snapshot: { ...snapshot, density: "comfortable" } } });
      expect(await readJobsViews(a)).toMatchObject({ revision: 4, defaultId: id, views: [{ name: "My shift", snapshot: { density: "comfortable" } }] });
      const removed = await mutateJobsViews(a, { revision: 4, change: { action: "delete", id } });
      expect(removed).toMatchObject({ revision: 5, defaultId: null, views: [] });
      expect(await readJobsViews(b)).toEqual(other);
    });
  });

  it("rejects stale revisions without replacing the stored state", async () => {
    const id = owner();
    await rollback(async () => {
      const first = await mutateJobsViews(id, { revision: 0, change: { action: "create", name: "Current", snapshot: jobsSnapshot(DEFAULT_JOBS_STATE) } });
      await expect(mutateJobsViews(id, { revision: 0, change: { action: "delete", id: first.views[0].id } }))
        .rejects.toMatchObject({ status: 409, code: "REVISION_CONFLICT" });
      expect(await readJobsViews(id)).toEqual(first);
    });
  });

  it("preserves malformed stored JSON and rolls it back with its fixture", async () => {
    const id = owner(), key = `admin_jobs_views_v1:${id}`;
    await rollback(async tx => {
      await tx.appSetting.create({ data: { key, value: { original: "unrecognized" } } });
      await expect(readJobsViews(id)).rejects.toMatchObject({ code: "STORAGE_INVALID" });
      await expect(mutateJobsViews(id, { revision: 0, change: { action: "create", name: "Replacement", snapshot: jobsSnapshot(DEFAULT_JOBS_STATE) } }))
        .rejects.toMatchObject({ code: "STORAGE_INVALID" });
      expect((await tx.appSetting.findUnique({ where: { key } }))?.value).toEqual({ original: "unrecognized" });
    });
  });

  it("reads legacy v1 columns without rewriting storage and persists explicit columns on mutation", async () => {
    const id = owner(), key = `admin_jobs_views_v1:${id}`, viewId = randomUUID();
    const { columns: _columns, ...legacySnapshot } = jobsSnapshot(DEFAULT_JOBS_STATE);
    const legacy = { version: 1, revision: 7, defaultId: viewId, views: [{ id: viewId, name: "Legacy", snapshot: legacySnapshot }] };
    await rollback(async tx => {
      await tx.appSetting.create({ data: { key, value: legacy } });
      const loaded = await readJobsViews(id);
      expect(loaded).toMatchObject({ revision: 7, defaultId: viewId, views: [{ snapshot: { columns: { client: true, cleaner: true, schedule: true } } }] });
      expect((await tx.appSetting.findUnique({ where: { key } }))?.value).toEqual(legacy);
      const snapshot = { ...loaded.views[0].snapshot, columns: { client: false, cleaner: true, schedule: false } };
      const updated = await mutateJobsViews(id, { revision: 7, change: { action: "update", id: viewId, snapshot } });
      expect(updated).toMatchObject({ revision: 8, defaultId: viewId, views: [{ name: "Legacy", snapshot }] });
      expect((await tx.appSetting.findUnique({ where: { key } }))?.value).toEqual(updated);
    });
  });

  it("preserves invalid column data instead of treating it as a legacy omission", async () => {
    const id = owner(), key = `admin_jobs_views_v1:${id}`, viewId = randomUUID();
    const invalid = { version: 1, revision: 1, defaultId: null, views: [{ id: viewId, name: "Invalid", snapshot: { ...jobsSnapshot(DEFAULT_JOBS_STATE), columns: { client: "yes", cleaner: true, schedule: true } } }] };
    await rollback(async tx => {
      await tx.appSetting.create({ data: { key, value: invalid } });
      await expect(readJobsViews(id)).rejects.toMatchObject({ code: "STORAGE_INVALID" });
      await expect(mutateJobsViews(id, { revision: 1, change: { action: "rename", id: viewId, name: "Replacement" } }))
        .rejects.toMatchObject({ code: "STORAGE_INVALID" });
      expect((await tx.appSetting.findUnique({ where: { key } }))?.value).toEqual(invalid);
    });
  });
});
