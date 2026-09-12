// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus, Prisma, Role } from "@prisma/client";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), role: vi.fn(), root: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.role }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: mocks.transaction,
  appSetting: { findUnique: mocks.root, upsert: mocks.root, deleteMany: mocks.root },
  jobAssignment: { findFirst: mocks.root }, job: { findUnique: mocks.root },
} }));

import { GET, PATCH, DELETE } from "@/app/api/cleaner/jobs/[id]/draft/route";
import { cleanerDraftIdentity } from "@/lib/cleaner/draft-identity";
import {
  clearSharedCleanerJobDraft, saveSharedCleanerJobDraft, withSharedCleanerJobDraftLock,
  type SharedCleanerJobDraftRecord,
} from "@/lib/cleaner/shared-job-draft";

const key = (id: string) => `cleaner_job_shared_draft_v1:${id}`;
const context = { params: { id: "job" } };
const request = (body: unknown = { editorSessionId: "a", state: {} }) => new NextRequest(
  "http://localhost/api/cleaner/jobs/job/draft", { method: "PATCH", body: JSON.stringify(body) }
);
const patch = (editorSessionId: string, state: Record<string, unknown>) => PATCH(request({ editorSessionId, state }), context);
const record = (): SharedCleanerJobDraftRecord => ({
  updatedAt: "2026-01-01T00:00:00.000Z", updatedByUserId: "cleaner", updatedByName: "Cleaner",
  editorSessionId: "a", state: { answers: { old: "value" } },
});
let rows: Map<string, SharedCleanerJobDraftRecord>;
let tails: Map<string, Promise<void>>;
let events: string[];
let assigned: boolean;
let status: JobStatus | null;
let failure: string | undefined;
let onAcquire: (() => void) | undefined;

// Simulated READ COMMITTED transactions, not actual PostgreSQL verification.
// Only the advisory lock queues callbacks; staged writes commit or roll back.
beforeEach(() => {
  vi.resetAllMocks();
  rows = new Map(); tails = new Map(); events = []; assigned = true;
  status = JobStatus.IN_PROGRESS; failure = undefined; onAcquire = undefined;
  mocks.role.mockResolvedValue({ user: { id: "cleaner", name: "Cleaner" } });
  mocks.root.mockImplementation(() => { throw new Error("Unexpected root database access"); });
  let sequence = 0;
  mocks.transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    const id = ++sequence;
    const held = new Set<string>();
    const releases: (() => void)[] = [];
    const pending = new Map<string, SharedCleanerJobDraftRecord | null>();
    const step = (stage: string) => {
      events.push(`${id}:${stage}`);
      if (failure === stage) { failure = undefined; throw new Error("private database details"); }
    };
    const tx = {
      $executeRaw: async (sql: TemplateStringsArray, value: string) => {
        expect([...sql]).toEqual(["SELECT pg_advisory_xact_lock(hashtext(", "))"]);
        expect(sql.raw).toBeDefined();
        expect(value.startsWith(key(""))).toBe(true);
        if (held.has(value)) return 1; // PostgreSQL transaction locks are reentrant.
        step("lock");
        const previous = tails.get(value) ?? Promise.resolve();
        tails.set(value, new Promise<void>((resolve) => releases.push(resolve)));
        await previous;
        held.add(value); step("acquired"); onAcquire?.();
        return 1;
      },
      jobAssignment: { findFirst: async (args: unknown) => {
        expect(held.has(key("job"))).toBe(true);
        expect(args).toEqual({ where: { jobId: "job", userId: "cleaner", removedAt: null }, select: { id: true } });
        step("assignment"); return assigned ? { id: "assignment" } : null;
      } },
      job: { findUnique: async (args: unknown) => {
        expect(held.has(key("job"))).toBe(true);
        expect(args).toEqual({ where: { id: "job" }, select: { status: true } });
        step("status"); return status === null ? null : { status };
      } },
      appSetting: {
        findUnique: async (args: { where: { key: string }; select: unknown }) => {
          expect(held.has(args.where.key)).toBe(true);
          expect(args.select).toEqual({ value: true }); step("read");
          const value = rows.get(args.where.key);
          await Promise.resolve();
          return value ? { value: structuredClone(value) } : null;
        },
        upsert: async (args: { where: { key: string }; create: { key: string; value: SharedCleanerJobDraftRecord }; update: { value: SharedCleanerJobDraftRecord } }) => {
          expect(held.has(args.where.key)).toBe(true);
          expect(args.create).toEqual({ key: args.where.key, value: args.update.value });
          pending.set(args.where.key, structuredClone(args.update.value)); step("write");
        },
        deleteMany: async (args: { where: { key: string } }) => {
          expect(held.has(args.where.key)).toBe(true);
          pending.set(args.where.key, null); step("delete");
        },
      },
    };
    try {
      const result = await callback(tx as unknown as Prisma.TransactionClient);
      step("commit");
      for (const [entry, value] of pending) value === null ? rows.delete(entry) : rows.set(entry, value);
      return result;
    } catch (error) { events.push(`${id}:rollback`); throw error; }
    finally { releases.forEach((release) => release()); }
  });
});

async function responseIs(response: Response, statusCode: number) {
  expect(response.status).toBe(statusCode);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("vary")).toBe("Cookie");
  return response.json();
}

describe("shared draft atomicity (simulated transactions)", () => {
  it.each([GET, PATCH, DELETE])("a valid identity does not bypass assignment authorization", async (handler) => {
    assigned = false;
    if (handler === GET) mocks.root.mockResolvedValueOnce(null);
    const req = request();
    req.headers.set("X-Cleaner-Draft-Identity", cleanerDraftIdentity({ user: { id: "cleaner" } }, "job"));
    await responseIs(await handler(req, context), 403);
    expect(events.some((event) => /:(read|write|delete)$/.test(event))).toBe(false);
  });

  it("a valid identity does not bypass the locked-job check", async () => {
    status = JobStatus.COMPLETED;
    const req = request();
    req.headers.set("X-Cleaner-Draft-Identity", cleanerDraftIdentity({ user: { id: "cleaner" } }, "job"));
    await responseIs(await PATCH(req, context), 409);
    expect(rows.size).toBe(0);
    expect(events).not.toContain("1:read");
  });

  it.each([GET, PATCH, DELETE])("accepts matching identity and legacy headerless requests", async (handler) => {
    for (const session of [{ user: { id: "cleaner" } }, { user: { id: "cleaner" }, impersonation: { actorId: "admin" } }]) {
      mocks.role.mockResolvedValue(session);
      for (const identity of [undefined, cleanerDraftIdentity(session, "job")]) {
        const req = request();
        if (identity !== undefined) req.headers.set("X-Cleaner-Draft-Identity", identity);
        if (handler === GET) mocks.root.mockResolvedValueOnce({ id: "assignment" }).mockResolvedValueOnce({ value: record() });
        await responseIs(await handler(req, context), 200);
      }
    }
  });

  it.each([GET, PATCH, DELETE])("rejects identities for another actor, effective user or job before draft access", async (handler) => {
    const session = { user: { id: "cleaner" }, impersonation: { actorId: "admin" } };
    mocks.role.mockResolvedValue(session);
    rows.set(key("job"), record());
    for (const identity of [
      "", "invalid", cleanerDraftIdentity({ user: { id: "cleaner" } }, "job"),
      cleanerDraftIdentity({ user: { id: "cleaner" }, impersonation: { actorId: "other-admin" } }, "job"),
      cleanerDraftIdentity({ user: { id: "other-cleaner" }, impersonation: { actorId: "admin" } }, "job"),
      cleanerDraftIdentity(session, "other-job"),
    ]) {
      const req = request(); req.headers.set("X-Cleaner-Draft-Identity", identity);
      expect(await responseIs(await handler(req, context), 409)).toEqual({ error: "Account changed. Reload this job." });
    }
    expect(rows.get(key("job"))).toEqual(record());
    expect(mocks.root).not.toHaveBeenCalled();
    expect(events.every((event) => /:(lock|acquired|commit)$/.test(event))).toBe(true);
  });

  it.each([GET, PATCH, DELETE])("resolves the session anew for identity checks", async (handler) => {
    const oldSession = { user: { id: "cleaner" }, impersonation: { actorId: "admin" } };
    mocks.role.mockResolvedValue({ ...oldSession, impersonation: { actorId: "different-admin" } });
    const req = request(); req.headers.set("X-Cleaner-Draft-Identity", cleanerDraftIdentity(oldSession, "job"));
    await responseIs(await handler(req, context), 409);
    expect(mocks.role).toHaveBeenCalledWith([Role.CLEANER]);
    expect(events.some((event) => /:(read|write|delete)$/.test(event))).toBe(false);
  });

  it("locks before assignment/status/read/merge/write and commits once", async () => {
    const body = await responseIs(await patch("a", { answers: { a: 1 } }), 200);
    expect(events).toEqual(["1:lock", "1:acquired", "1:assignment", "1:status", "1:read", "1:write", "1:commit"]);
    expect(rows.get(key("job"))).toMatchObject({ updatedAt: body.updatedAt, updatedByUserId: "cleaner", updatedByName: "Cleaner", editorSessionId: "a" });
    expect(mocks.role).toHaveBeenCalledWith([Role.CLEANER]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.root).not.toHaveBeenCalled();
  });

  it("concurrent cross-editor saves retain both answers and media", async () => {
    const responses = await Promise.all([
      patch("a", { updatedAt: "2026-01-01", answers: { a: 1, common: "old" }, uploads: { photo: [{ key: "a" }] } }),
      patch("b", { updatedAt: "2026-01-02", answers: { b: 2, common: "new" }, uploads: { photo: [{ key: "b" }] } }),
    ]);
    for (const response of responses) await responseIs(response, 200);
    expect(rows.get(key("job"))?.state).toMatchObject({ answers: { a: 1, b: 2, common: "new" }, uploads: { photo: [{ key: "a" }, { key: "b" }] } });
    expect(events.indexOf("2:acquired")).toBeGreaterThan(events.indexOf("1:commit"));
  });

  it("same editor replaces state, allowing removed answers and media", async () => {
    rows.set(key("job"), record());
    await responseIs(await patch("a", { uploads: {}, answers: {} }), 200);
    expect(rows.get(key("job"))?.state).toEqual({ uploads: {}, answers: {} });
  });

  it.each([JobStatus.SUBMITTED, JobStatus.QA_REVIEW, JobStatus.COMPLETED, JobStatus.INVOICED, null])("rejects locked or missing job %s after acquiring lock", async (locked) => {
    onAcquire = () => { status = locked; };
    await responseIs(await patch("a", {}), 409);
    expect(events).not.toContain("1:read"); expect(rows.size).toBe(0);
  });

  it.each(Object.values(JobStatus).filter((value) => !["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(value)))("preserves editable status %s without acceptance filtering", async (editable) => {
    status = editable;
    await responseIs(await patch("a", {}), 200);
  });

  it.each([PATCH, DELETE])("checks active assignment inside the lock", async (handler) => {
    onAcquire = () => { assigned = false; };
    await responseIs(await handler(request(), context), 403);
    expect(events).toEqual(["1:lock", "1:acquired", "1:assignment", "1:commit"]);
  });

  it.each([GET, PATCH, DELETE])("returns private auth and safe unexpected errors", async (handler) => {
    for (const [error, code] of [[new Error("UNAUTHORIZED"), 401], [new Error("FORBIDDEN"), 403], [new Error("secret"), 500], [null, 500]] as const) {
      mocks.role.mockRejectedValueOnce(error);
      const body = await responseIs(await handler(request(), context), code);
      expect(JSON.stringify(body)).not.toContain("secret");
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and invalid envelopes privately", async () => {
    await responseIs(await PATCH(new NextRequest("http://localhost", { method: "PATCH", body: "{" }), context), 400);
    await responseIs(await PATCH(request({ editorSessionId: "", state: [] }), context), 400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(["lock", "assignment", "status", "read", "write", "commit"])("rolls back %s failure, hides details, and releases lock", async (stage) => {
    rows.set(key("job"), record()); failure = stage;
    expect(await responseIs(await patch("a", { changed: true }), 500)).toEqual({ error: "Unable to process job draft" });
    expect(rows.get(key("job"))).toEqual(record()); expect(events).toContain("1:rollback");
    await responseIs(await patch("a", { retry: true }), 200);
  });

  it("submit-style standalone clear waits for a save and removes its committed draft", async () => {
    let entered!: () => void;
    const acquired = new Promise<void>((resolve) => { entered = resolve; });
    onAcquire = () => entered();
    const saving = patch("a", {});
    await acquired;
    const clearing = clearSharedCleanerJobDraft("job");
    await saving; await clearing;
    expect(rows.size).toBe(0);
    expect(events.indexOf("2:delete")).toBeGreaterThan(events.indexOf("1:commit"));
  });

  it("a save queued behind clear observes completed status and cannot resurrect the draft", async () => {
    rows.set(key("job"), record());
    onAcquire = () => { status = JobStatus.COMPLETED; };
    const clearing = clearSharedCleanerJobDraft("job");
    const saving = patch("b", { resurrect: true });
    await clearing; await responseIs(await saving, 409);
    expect(rows.size).toBe(0); expect(events).not.toContain("2:write");
  });

  it("DELETE still clears locked jobs, using one transaction", async () => {
    rows.set(key("job"), record()); status = JobStatus.COMPLETED;
    await responseIs(await DELETE(request(), context), 200);
    expect(rows.size).toBe(0); expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["1:lock", "1:acquired", "1:assignment", "1:read", "1:delete", "1:commit"]);
  });

  it.each(["delete", "commit"])("clear %s failure rolls back and DELETE hides details", async (stage) => {
    rows.set(key("job"), record()); failure = stage;
    await responseIs(await DELETE(request(), context), 500);
    expect(rows.get(key("job"))).toEqual(record());
  });

  it("optional transaction helpers do not nest and rollback with their caller", async () => {
    rows.set(key("job"), record());
    await expect(withSharedCleanerJobDraftLock("job", async (tx) => {
      await saveSharedCleanerJobDraft("job", { ...record(), state: {} }, tx);
      await clearSharedCleanerJobDraft("job", tx);
      throw new Error("abort");
    })).rejects.toThrow("abort");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(rows.get(key("job"))).toEqual(record());
  });

  it("standalone saves also lock, and job keys are independent", async () => {
    await Promise.all([saveSharedCleanerJobDraft("one", record()), saveSharedCleanerJobDraft("two", record())]);
    expect(rows.size).toBe(2);
    expect(events.indexOf("2:acquired")).toBeLessThan(events.indexOf("1:commit"));
  });

  it("GET retains assignment authorization and private responses", async () => {
    mocks.root.mockResolvedValueOnce({ id: "assignment" }).mockResolvedValueOnce({ value: record() });
    expect(await responseIs(await GET(request(), context), 200)).toEqual({ draft: record() });
    mocks.root.mockResolvedValueOnce(null);
    await responseIs(await GET(request(), context), 403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("keeps receipt-backed media through a stale same-editor save and cannot forge the receipt ledger", async () => {
    const initial = record();
    initial.evidenceReceipts = { capture: { key: "proof", fieldId: "photo", formRevision: "revision", draftIdentity: "identity" } };
    initial.state.uploads = { photo: [{ key: "proof", url: "url" }] };
    rows.set(key("job"), initial);
    await responseIs(await patch("a", { uploads: {}, evidenceReceipts: { forged: {} } }), 200);
    expect(rows.get(key("job"))?.evidenceReceipts).toEqual(initial.evidenceReceipts);
    expect(rows.get(key("job"))?.state.uploads).toEqual(initial.state.uploads);
  });
  it("generic clear keeps evidence receipts and tombstones through later stale saves", async () => {
    const initial = record();
    initial.evidenceReceipts = {
      kept: { key: "kept", fieldId: "photo", formRevision: "revision", draftIdentity: "identity" },
      removed: { key: "removed", fieldId: "photo", formRevision: "revision", draftIdentity: "identity", detached: true },
    };
    initial.state.uploads = { photo: [{ key: "kept" }] };
    rows.set(key("job"), initial);
    await responseIs(await DELETE(request(), context), 200);
    expect(rows.get(key("job"))?.evidenceReceipts).toEqual(initial.evidenceReceipts);
    expect(rows.get(key("job"))?.state.answers).toBeUndefined();
    await responseIs(await patch("a", { uploads: { photo: [{ key: "removed" }] } }), 200);
    expect(rows.get(key("job"))?.state.uploads).toEqual({ photo: [{ key: "kept" }] });
  });
  it("does not resurrect explicitly detached receipts from a stale autosave", async () => {
    const initial = record();
    initial.evidenceReceipts = { capture: { key: "proof", fieldId: "photo", formRevision: "revision", draftIdentity: "identity", detached: true } };
    rows.set(key("job"), initial);
    await responseIs(await patch("a", { uploads: { photo: [{ key: "proof" }], other: [{ key: "proof" }] },
      bulkPool: [{ key: "proof" }], taskDrafts: { task: { proof: [{ key: "proof" }] } } }), 200);
    expect(rows.get(key("job"))?.state.uploads).toEqual({ photo: [], other: [] });
    expect(rows.get(key("job"))?.state.bulkPool).toEqual([]);
    expect(rows.get(key("job"))?.state.taskDrafts).toEqual({ task: { proof: [] } });
  });
});
