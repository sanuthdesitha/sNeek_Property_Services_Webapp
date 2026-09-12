// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({ role: vi.fn(), read: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: mocks.read }, $transaction: mocks.transaction } }));
import { GET, PATCH } from "@/app/api/me/jobs-views/route";
import { requireJobsViewsContext } from "@/lib/jobs/views-context";
import { jobsSnapshot, DEFAULT_JOBS_STATE } from "@/lib/jobs/workspace-state";
import { emptyJobsViews, type JobsViewAction } from "@/lib/jobs/saved-views";

let rows: Map<string, unknown>;
let tails: Map<string, Promise<void>>;
let events: string[];
let failure: string;
let session: { user: { id: string; role: Role }; impersonation?: { actorId: string; mode: "FULL" | "READ_ONLY"; startedAt: number } };
const key = (owner = "owner") => `admin_jobs_views_v1:${owner}`;
const snapshot = jobsSnapshot(DEFAULT_JOBS_STATE);

beforeEach(() => {
  vi.resetAllMocks(); rows = new Map(); tails = new Map(); events = []; failure = "";
  session = { user: { id: "owner", role: Role.ADMIN } };
  mocks.role.mockImplementation(async () => session);
  mocks.read.mockImplementation(async ({ where }: any) => {
    if (failure === "read") throw new Error("private storage detail");
    return rows.has(where.key) ? { value: rows.get(where.key) } : null;
  });
  // Transaction simulation only: real helper, staged writes and per-key lock queues.
  mocks.transaction.mockImplementation(async (run: any, options: any) => {
    expect(options.isolationLevel).toBe("ReadCommitted");
    expect(options.timeout).toBe(10_000);
    let release = () => {};
    let held = "";
    let staged: unknown;
    const tx = {
      $executeRaw: async (sql: TemplateStringsArray, lockKey: string) => {
        expect(sql.join("?")).toBe("SELECT pg_advisory_xact_lock(hashtext(?))");
        const previous = tails.get(lockKey) ?? Promise.resolve();
        const gate = new Promise<void>(resolve => { release = resolve; });
        tails.set(lockKey, previous.then(() => gate));
        await previous;
        held = lockKey; events.push("lock:" + lockKey);
      },
      appSetting: {
        findUnique: async ({ where }: any) => {
          expect(where.key).toBe(held); events.push("read:" + held);
          return mocks.read({ where });
        },
        upsert: async ({ where, create, update }: any) => {
          expect(where.key).toBe(held); expect(create.value).toEqual(update.value);
          events.push("write:" + held);
          if (failure === "write") throw new Error("private storage detail");
          staged = update.value;
        },
      },
    };
    try {
      const result = await run(tx);
      if (failure === "commit") throw new Error("private commit detail");
      if (staged !== undefined) rows.set(held, staged);
      return result;
    } finally { release(); }
  });
});

async function request(method: "GET" | "PATCH", body?: unknown, context?: string) {
  const token = context ?? (await requireJobsViewsContext()).context;
  const req = new NextRequest("http://localhost/api/me/jobs-views", {
    method, headers: { "x-jobs-view-context": token, "content-type": "application/json" },
    ...(method === "PATCH" ? { body: JSON.stringify(body) } : {}),
  });
  const response = await (method === "GET" ? GET(req) : PATCH(req));
  return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
}
const change = (revision: number, action: JobsViewAction) => request("PATCH", { revision, change: action });

describe("personal Jobs views API and store", () => {
  it("reads legacy columns without writing and persists normalized views on an explicit rename", async () => {
    const { columns: _columns, ...legacy } = snapshot;
    const id = "11111111-1111-4111-8111-111111111111";
    const stored = { ...emptyJobsViews(), revision: 4, defaultId: id, views: [{ id, name: "Legacy", snapshot: legacy }] };
    rows.set(key(), stored);
    const result = await request("GET");
    expect(result.status).toBe(200); expect(result.body.data.views[0].snapshot).toEqual(snapshot);
    expect(rows.get(key())).toEqual(stored); expect(mocks.transaction).not.toHaveBeenCalled();
    const renamed = await change(4, { action: "rename", id, name: "Preserved" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({ revision: 5, defaultId: id, views: [{ id, name: "Preserved", snapshot }] });
    expect(rows.get(key())).toEqual(renamed.body.data);
  });
  it("rejects old create/update requests missing columns without overwriting selected columns", async () => {
    const columns = { client: false, cleaner: true, schedule: false };
    const created = await change(0, { action: "create", name: "Custom", snapshot: { ...snapshot, columns } });
    const id = created.body.data.views[0].id;
    const { columns: _columns, ...legacy } = snapshot;
    const before = rows.get(key());
    const result = await request("PATCH", { revision: 1, change: { action: "update", id, snapshot: legacy } });
    expect(result.status).toBe(400); expect(rows.get(key())).toEqual(before);
    expect((await request("GET")).body.data.views[0].snapshot.columns).toEqual(columns);
  });
  it("retains an invalid stored columns object on failed read and write", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const stored = { ...emptyJobsViews(), views: [{ id, name: "Do not erase", snapshot: { ...snapshot, columns: { client: true } } }] };
    rows.set(key(), stored);
    expect((await request("GET")).body.code).toBe("STORAGE_INVALID");
    expect((await change(0, { action: "rename", id, name: "New" })).body.code).toBe("STORAGE_INVALID");
    expect(rows.get(key())).toEqual(stored);
  });
  it("returns an empty collection only for a missing owned key", async () => {
    const response = await request("GET");
    expect(response.status).toBe(200); expect(response.body.data).toEqual(emptyJobsViews());
    expect(response.cache).toContain("no-store");
    expect(mocks.role).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
    expect(mocks.read).toHaveBeenCalledWith({ where: { key: key() } });
  });
  it("creates, updates, renames, defaults/unsets and deletes without changing other keys", async () => {
    rows.set(key("other"), { untouched: true });
    const created = await change(0, { action: "create", name: " Morning ", snapshot });
    expect(created.status).toBe(200);
    const id = created.body.data.views[0].id;
    expect(created.body.data.views[0].name).toBe("Morning");
    const updated = await change(1, { action: "update", id, snapshot: { ...snapshot, sort: "latest", density: "compact" } });
    expect(updated.body.data.views[0].snapshot).toEqual({ ...snapshot, sort: "latest", density: "compact" });
    expect((await change(2, { action: "rename", id, name: "Evening" })).body.data.views[0].name).toBe("Evening");
    expect((await change(3, { action: "default", id })).body.data.defaultId).toBe(id);
    expect((await change(4, { action: "default", id: null })).body.data.defaultId).toBeNull();
    await change(5, { action: "default", id });
    expect((await change(6, { action: "delete", id })).body.data).toEqual({ ...emptyJobsViews(), revision: 7 });
    expect(rows.get(key("other"))).toEqual({ untouched: true });
    expect(events.slice(0, 3)).toEqual(["lock:" + key(), "read:" + key(), "write:" + key()]);
  });
  it("serializes concurrent first writes and returns 409 instead of losing a view", async () => {
    const results = await Promise.all([change(0, { action: "create", name: "One", snapshot }), change(0, { action: "create", name: "Two", snapshot })]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect((await request("GET")).body.data.views).toHaveLength(1);
    expect(results.find(result => result.status === 409)?.body.code).toBe("REVISION_CONFLICT");
  });
  it.each(["read", "write", "commit"])("returns a truthful redacted error for %s failure, with retry", async stage => {
    failure = stage;
    const result = await change(0, { action: "create", name: "One", snapshot });
    expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain("private");
    expect(rows.size).toBe(0);
    failure = "";
    expect((await change(0, { action: "create", name: "One", snapshot })).status).toBe(200);
  });
  it("refuses corrupt storage on reads and mutations without replacing it", async () => {
    rows.set(key(), { invalid: true });
    expect((await request("GET")).body.code).toBe("STORAGE_INVALID");
    expect((await change(0, { action: "create", name: "One", snapshot })).status).toBe(500);
    expect(rows.get(key())).toEqual({ invalid: true });
  });
  it("rejects invalid/owner supplied payloads before opening a transaction", async () => {
    for (const body of [
      { revision: 0, ownerId: "other", change: { action: "create", name: "One", snapshot } },
      { revision: 0, change: { action: "create", name: " ", snapshot } },
      { revision: 0, change: { action: "create", name: "One", snapshot: { ...snapshot, page: 3 } } },
    ]) expect((await request("PATCH", body)).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("bounds collections, rejects duplicate names and missing IDs", async () => {
    for (let i = 0; i < 20; i++) expect((await change(i, { action: "create", name: `View ${i}`, snapshot })).status).toBe(200);
    expect((await change(20, { action: "create", name: "Overflow", snapshot })).body.code).toBe("VIEW_LIMIT");
    const views = (await request("GET")).body.data.views;
    expect((await change(20, { action: "rename", id: views[1].id, name: "VIEW 0" })).body.code).toBe("DUPLICATE_NAME");
    expect((await change(20, { action: "delete", id: "11111111-1111-4111-8111-111111111111" })).status).toBe(404);
  });
  it.each(["owner", "actor", "mode", "startedAt"])("rejects old-page context when %s changes before any storage access", async field => {
    session.impersonation = { actorId: "admin-a", mode: "FULL", startedAt: 1 };
    const context = (await requireJobsViewsContext()).context;
    if (field === "owner") session.user.id = "different-owner";
    if (field === "actor") session.impersonation.actorId = "admin-b";
    if (field === "mode") session.impersonation.mode = "READ_ONLY";
    if (field === "startedAt") session.impersonation.startedAt = 2;
    expect((await request("PATCH", { revision: 0, change: { action: "create", name: "Old tab", snapshot } }, context)).body.code).toBe("CONTEXT_CHANGED");
    expect((await request("GET", undefined, context)).status).toBe(409);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("uses effective owner storage while real actor distinguishes contexts", async () => {
    session.impersonation = { actorId: "admin-a", mode: "FULL", startedAt: 1 };
    const first = await requireJobsViewsContext();
    expect(first.context).not.toContain("owner");
    await change(0, { action: "create", name: "Owned", snapshot });
    session.impersonation.actorId = "admin-b";
    expect((await requireJobsViewsContext()).context).not.toBe(first.context);
    expect((await request("GET")).body.data.views[0].name).toBe("Owned");
    expect(Array.from(rows.keys())).toEqual([key()]);
  });
  it("blocks read-only impersonation writes even without middleware", async () => {
    session.impersonation = { actorId: "admin", mode: "READ_ONLY", startedAt: 1 };
    expect((await request("GET")).status).toBe(200);
    expect((await change(0, { action: "create", name: "No", snapshot })).body.code).toBe("IMPERSONATION_READ_ONLY");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]] as const)("preserves %s role failures", async (message, status) => {
    mocks.role.mockRejectedValue(new Error(message));
    expect((await request("GET", undefined, "old-context")).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
