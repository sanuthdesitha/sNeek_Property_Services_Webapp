// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { destinationMedia, setDestinationMedia, reconcileEvidenceState, type EvidenceDestination } from "@/lib/cleaner/evidence-destination";
import {
  clearSharedCleanerJobDraft,
  getSharedCleanerJobDraft,
  saveSharedCleanerJobDraft,
  withSharedCleanerJobDraftLock,
  type SharedCleanerJobDraftRecord,
} from "@/lib/cleaner/shared-job-draft";

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get() { throw new Error("Draft DB tests must use the explicit test transaction"); },
  }),
}));

const databaseUrl = process.env.SNEEK_TEST_DATABASE_URL;
const ownedKeys: string[] = [];
let prisma: PrismaClient | undefined;

function fixture() {
  const jobId = `qa-draft-lock-${randomUUID()}`;
  ownedKeys.push(`cleaner_job_shared_draft_v1:${jobId}`);
  return jobId;
}

function draft(state: Record<string, unknown>): SharedCleanerJobDraftRecord {
  return {
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedByUserId: "synthetic-not-an-actor",
    updatedByName: "Draft lock test",
    editorSessionId: randomUUID(),
    state,
  };
}

async function rollback(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  if (!prisma) throw new Error("Explicit test database was not initialized");
  const finished = new Error("QA_DRAFT_TRANSACTION_ROLLBACK");
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '6s'`;
      await run(tx);
      throw finished;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    });
  } catch (error) {
    if (error !== finished) throw error;
  }
}

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {
    resolve,
    async wait() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Draft lock gate timed out")), 4_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

describe.skipIf(!databaseUrl)("cleaner draft locks (explicit local PostgreSQL only)", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || !/^postgres(ql)?:$/.test(url.protocol)
      // Prevent connection-string options from overriding the validated host.
      || Array.from(url.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) {
      throw new Error("SNEEK_TEST_DATABASE_URL must identify a local PostgreSQL test database.");
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      expect(await prisma.appSetting.findMany({
        where: { key: { in: ownedKeys } }, select: { key: true },
      })).toEqual([]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("saves, gets, replaces and clears only its synthetic draft inside a rolled-back transaction", async () => {
    const jobId = fixture();
    await rollback(async tx => {
      expect(await getSharedCleanerJobDraft(jobId, tx)).toBeNull();
      const initial = draft({ rooms: { kitchen: true }, notes: "initial" });
      await saveSharedCleanerJobDraft(jobId, initial, tx);
      expect(await getSharedCleanerJobDraft(jobId, tx)).toEqual(initial);
      const replacement = draft({ notes: "replacement" });
      await saveSharedCleanerJobDraft(jobId, replacement, tx);
      expect(await getSharedCleanerJobDraft(jobId, tx)).toEqual(replacement);
      await clearSharedCleanerJobDraft(jobId, tx);
      await clearSharedCleanerJobDraft(jobId, tx);
      expect(await getSharedCleanerJobDraft(jobId, tx)).toBeNull();
    });
  });

  it("rolls back a helper write when its caller fails", async () => {
    const jobId = fixture();
    const failure = new Error("Expected caller failure");
    await expect(rollback(async tx => {
      await saveSharedCleanerJobDraft(jobId, draft({ partial: true }), tx);
      expect(await getSharedCleanerJobDraft(jobId, tx)).not.toBeNull();
      throw failure;
    })).rejects.toBe(failure);
    await rollback(async tx => {
      expect(await getSharedCleanerJobDraft(jobId, tx)).toBeNull();
    });
  });

  it("preserves typed destination receipts through real JSON storage, stale autosave and clear", async () => {
    const jobId = fixture();
    await rollback(async tx => {
      const destinations: EvidenceDestination[] = [{ type: "bulkPool" }, { type: "jobTask", taskId: "task" }, { type: "laundry" }, { type: "carryForwardNew" }];
      let initial = draft({ answers: { stale: false } });
      for (const [index, destination] of destinations.entries()) {
        const media = { key: `forms/${jobId}/${index}/actor/photo.jpg`, url: `/fixture/${index}` };
        initial = { ...initial, state: setDestinationMedia(initial.state, destination, [media]), evidenceReceipts: { ...initial.evidenceReceipts, [index]: { key: media.key, fieldId: "unused", destination, version: 0, formRevision: "fixture", draftIdentity: "actor" } } };
      }
      await saveSharedCleanerJobDraft(jobId, initial, tx);
      const stored = (await getSharedCleanerJobDraft(jobId, tx))!;
      expect(stored.evidenceReceipts).toEqual(initial.evidenceReceipts);
      await saveSharedCleanerJobDraft(jobId, { ...stored, state: reconcileEvidenceState({ answers: { stale: true } }, stored.state, stored.evidenceReceipts!) }, tx);
      await clearSharedCleanerJobDraft(jobId, tx);
      const cleared = (await getSharedCleanerJobDraft(jobId, tx))!;
      for (const destination of destinations) expect(destinationMedia(cleared.state, destination)).toEqual(destinationMedia(initial.state, destination));
      expect(cleared.state.answers).toBeUndefined();
    });
  });

  it("retains acknowledged evidence and removal tombstones when a real stored draft is cleared", async () => {
    const jobId = fixture();
    await rollback(async tx => {
      const kept = { key: `forms/${jobId}/kept/actor/photo.jpg`, url: "https://example.invalid/kept" };
      const removed = { key: `forms/${jobId}/removed/actor/photo.jpg`, url: "https://example.invalid/removed" };
      const value = draft({ answers: { notes: "discard this answer" }, uploads: { room: [kept, removed] } });
      value.evidenceReceipts = {
        kept: { key: kept.key, fieldId: "room", formRevision: "revision", draftIdentity: "actor" },
        removed: { key: removed.key, fieldId: "room", formRevision: "revision", draftIdentity: "actor", detached: true },
      };
      await saveSharedCleanerJobDraft(jobId, value, tx);
      await clearSharedCleanerJobDraft(jobId, tx);
      const after = await getSharedCleanerJobDraft(jobId, tx);
      expect(after?.evidenceReceipts).toEqual(value.evidenceReceipts);
      expect(after?.state.uploads).toEqual({ room: [kept] });
      expect(after?.state.answers).toBeUndefined();
      await clearSharedCleanerJobDraft(jobId, tx);
      expect((await getSharedCleanerJobDraft(jobId, tx))?.evidenceReceipts).toEqual(value.evidenceReceipts);
    });
  });

  it("reuses the optional transaction for reentrant locks and nested helper calls", async () => {
    const jobId = fixture();
    await rollback(async tx => {
      const result = await withSharedCleanerJobDraftLock(jobId, async lockedTx => {
        expect(lockedTx).toBe(tx);
        return withSharedCleanerJobDraftLock(jobId, async nestedTx => {
          expect(nestedTx).toBe(tx);
          const value = draft({ complete: true });
          await saveSharedCleanerJobDraft(jobId, value, nestedTx);
          expect(await getSharedCleanerJobDraft(jobId, nestedTx)).toEqual(value);
          await clearSharedCleanerJobDraft(jobId, nestedTx);
          expect(await getSharedCleanerJobDraft(jobId, nestedTx)).toBeNull();
          return "existing transaction";
        }, lockedTx);
      }, tx);
      expect(result).toBe("existing transaction");
    });
  });

  it("blocks a concurrent helper lock until rollback, then sees no partial state and preserves successive updates", async () => {
    const jobId = fixture();
    const firstReady = gate<void>();
    const secondPid = gate<number>();
    let secondEntered = false;
    let observedBlocking = false;

    const first = rollback(async tx => {
      await saveSharedCleanerJobDraft(jobId, draft({ partial: "must roll back" }), tx);
      const [owner] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      firstReady.resolve();
      const waiter = await secondPid.wait();
      expect(waiter).not.toBe(owner.pid);
      // Observe actual lock contention while the owning transaction is still open.
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const [row] = await tx.$queryRaw<{ blocked: boolean }[]>`
          SELECT ${owner.pid}::int = ANY(pg_blocking_pids(${waiter}::int)) AS blocked
        `;
        if (row.blocked) { observedBlocking = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(observedBlocking).toBe(true);
      expect(secondEntered).toBe(false);
      // Returning forces rollback, releasing the transaction-scoped advisory lock.
    });

    const second = (async () => {
      await firstReady.wait();
      await rollback(async tx => {
        const [waiter] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        secondPid.resolve(waiter.pid);
        await withSharedCleanerJobDraftLock(jobId, async lockedTx => {
          secondEntered = true;
          expect(observedBlocking).toBe(true);
          expect(await getSharedCleanerJobDraft(jobId, lockedTx)).toBeNull();
          const initial = draft({ rooms: { kitchen: true }, notes: "retained" });
          await saveSharedCleanerJobDraft(jobId, initial, lockedTx);
          const current = await getSharedCleanerJobDraft(jobId, lockedTx);
          expect(current).toEqual(initial);
          const merged = { ...initial, state: { ...current!.state, photos: ["synthetic-photo"] } };
          await saveSharedCleanerJobDraft(jobId, merged, lockedTx);
          expect(await getSharedCleanerJobDraft(jobId, lockedTx)).toEqual(merged);
        }, tx);
      });
    })();

    // Always drain both transactions, even on gate, database, or assertion failure.
    const results = await Promise.allSettled([first, second]);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    expect(secondEntered).toBe(true);
    await rollback(async tx => {
      expect(await getSharedCleanerJobDraft(jobId, tx)).toBeNull();
    });
  }, 30_000);
});
