// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  rootRead: vi.fn(),
  rootWrite: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
    appSetting: { findUnique: mocks.rootRead, upsert: mocks.rootWrite },
  },
}));

import {
  clientApprovalVersion,
  createClientApproval,
  updateClientApprovalById,
  respondClientApproval,
  counterClientApproval,
  reopenCounteredApproval,
  deleteClientApprovalById,
  type ClientApprovalRecord,
} from "@/lib/commercial/client-approvals";

const KEY = "client_approvals_v1";
const input = {
  clientId: "client", title: "Approval", description: "Work", amount: 100,
  requestedByUserId: "admin",
};
const approve = (id: string) => respondClientApproval({
  expectedVersion: clientApprovalVersion(committed?.approvals.find((row) => row.id === id) ?? record(id)),
  id, clientId: "client", decision: "APPROVE", respondedByUserId: "user",
});
const counter = (id: string) => counterClientApproval({
  expectedVersion: clientApprovalVersion(committed?.approvals.find((row) => row.id === id) ?? record(id)),
  id, clientId: "client", amount: 80, note: "Proposal", counteredByUserId: "user",
});
function record(id: string, patch: Partial<ClientApprovalRecord> = {}): ClientApprovalRecord {
  return {
    ...input, id, propertyId: null, jobId: null, quoteId: null, currency: "AUD",
    status: "PENDING", requestedAt: "2026-01-01T00:00:00.000Z", expiresAt: null,
    respondedByUserId: null, respondedAt: null, responseNote: null,
    counterAmount: null, counterNote: null, counterAt: null, counterByUserId: null,
    metadata: null, createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z", ...patch,
  };
}

type Store = { approvals: ClientApprovalRecord[] };
type Stage = "lock" | "read" | "write" | "commit";
let committed: Store | null;
let events: string[];
let failure: Stage | undefined;
let sequence: number;
let tails: Map<string, Promise<void>>;

// A transactional test double, not PostgreSQL verification. Transactions start
// concurrently; only the tagged advisory-lock call queues them. Writes are
// private until commit, and the lock is released on either commit or rollback.
beforeEach(() => {
  vi.clearAllMocks();
  committed = null;
  events = [];
  failure = undefined;
  sequence = 0;
  tails = new Map();
  mocks.rootRead.mockImplementation(() => { throw new Error("root read"); });
  mocks.rootWrite.mockImplementation(() => { throw new Error("root write"); });
  mocks.transaction.mockImplementation(async (callback: (tx: Prisma.TransactionClient) => unknown) => {
    const id = ++sequence;
    let locked = false;
    let release: (() => void) | undefined;
    let pending: Store | undefined;
    const step = (stage: Stage) => {
      events.push(`${id}:${stage}`);
      if (failure === stage) {
        failure = undefined;
        throw new Error(`failed ${stage}`);
      }
    };
    const tx = {
      $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
        expect(Array.from(sql)).toEqual([
          "SELECT pg_advisory_xact_lock(hashtext(", "))",
        ]);
        expect(sql.raw).toBeDefined();
        expect(values).toEqual([KEY]);
        step("lock");
        const key = String(values[0]);
        const previous = tails.get(key) ?? Promise.resolve();
        tails.set(key, new Promise<void>((resolve) => { release = resolve; }));
        await previous;
        locked = true;
        events.push(`${id}:acquired`);
        return 1;
      },
      appSetting: {
        findUnique: async (args: unknown) => {
          expect(locked).toBe(true);
          expect(args).toEqual({ where: { key: KEY } });
          step("read");
          const snapshot = structuredClone(committed);
          await Promise.resolve();
          return snapshot === null ? null : { key: KEY, value: snapshot };
        },
        upsert: async (args: {
          where: { key: string }; create: { key: string; value: Store };
          update: { value: Store };
        }) => {
          expect(locked).toBe(true);
          expect(args.where).toEqual({ key: KEY });
          expect(args.create.key).toBe(KEY);
          expect(args.create.value).toEqual(args.update.value);
          pending = structuredClone(args.update.value);
          step("write");
          await Promise.resolve();
          return { key: KEY, value: pending };
        },
      },
    };
    try {
      const result = await callback(tx as unknown as Prisma.TransactionClient);
      step("commit");
      if (pending) committed = pending;
      return result;
    } catch (error) {
      events.push(`${id}:rollback`);
      throw error;
    } finally {
      release?.();
    }
  });
});

describe("client approval mutation transactions (simulated)", () => {
  it.each([
    ["create", () => createClientApproval(input)],
    ["update", () => updateClientApprovalById("pending", { title: "Updated" })],
    ["respond", () => approve("pending")],
    ["counter", () => counter("pending")],
    ["reopen", () => reopenCounteredApproval({ id: "countered", amount: 90 })],
    ["delete", () => deleteClientApprovalById("pending")],
  ] as const)("%s locks before reading and uses only the transaction client", async (_, mutate) => {
    committed = { approvals: [record("pending"), record("countered", { status: "COUNTERED" })] };
    await mutate();
    expect(events).toEqual(["1:lock", "1:acquired", "1:read", "1:write", "1:commit"]);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 15_000,
    });
    expect(mocks.rootRead).not.toHaveBeenCalled();
    expect(mocks.rootWrite).not.toHaveBeenCalled();
  });

  it.each(["lock", "read", "write", "commit"] as const)("propagates %s failures without committing and allows a later writer", async (stage) => {
    committed = { approvals: [record("existing")] };
    const before = structuredClone(committed);
    failure = stage;
    await expect(createClientApproval(input)).rejects.toThrow(`failed ${stage}`);
    expect(committed).toEqual(before);
    expect(events.at(-1)).toBe("1:rollback");
    if (stage === "lock") expect(events).toEqual(["1:lock", "1:rollback"]);
    if (stage === "read") expect(events).not.toContain("1:write");
    await createClientApproval(input);
    expect(committed!.approvals).toHaveLength(2);
  });

  it("rolls back a rejected policy check and releases the lock for a queued writer", async () => {
    committed = { approvals: [record("existing")] };
    const results = await Promise.allSettled([
      counterClientApproval({ id: "existing", clientId: "other", amount: 80, counteredByUserId: "user", expectedVersion: clientApprovalVersion(record("existing")) }),
      approve("existing"),
    ]);
    expect(results[0]).toMatchObject({ status: "rejected", reason: new Error("FORBIDDEN") });
    expect(results[1].status).toBe("fulfilled");
    expect(events).not.toContain("1:write");
    expect(committed!.approvals[0].status).toBe("APPROVED");
  });

  it("does not write for missing records", async () => {
    expect(await updateClientApprovalById("missing", {})).toBeNull();
    expect(await approve("missing")).toBeNull();
    expect(await counter("missing")).toBeNull();
    expect(await reopenCounteredApproval({ id: "missing" })).toBeNull();
    expect(await deleteClientApprovalById("missing")).toBe(false);
    expect(events.filter((event) => event.endsWith(":read"))).toHaveLength(5);
    expect(events.some((event) => event.endsWith(":write"))).toBe(false);
    expect(committed).toBeNull();
  });

  it("preserves parallel creates starting with an absent setting", async () => {
    const created = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      createClientApproval({ ...input, title: `Approval ${i}` }),
    ));
    expect(committed!.approvals).toHaveLength(20);
    expect(new Set(committed!.approvals.map((row) => row.id))).toEqual(new Set(created.map((row) => row.id)));
    expect(events.indexOf("2:lock")).toBeLessThan(events.indexOf("1:commit"));
    expect(events.indexOf("2:read")).toBeGreaterThan(events.indexOf("1:commit"));
  });

  it("preserves all six parallel writer changes on different records", async () => {
    committed = { approvals: [
      record("update"), record("respond"), record("counter"), record("delete"),
      record("reopen", { status: "COUNTERED", counterAmount: 75, counterNote: "Old" }),
    ] };
    const [created, , , , reopened] = await Promise.all([
      createClientApproval(input), updateClientApprovalById("update", { title: "Changed" }),
      approve("respond"), counter("counter"),
      reopenCounteredApproval({ id: "reopen", amount: 90 }), deleteClientApprovalById("delete"),
    ]);
    const rows = new Map(committed!.approvals.map((row) => [row.id, row]));
    expect(rows.size).toBe(5);
    expect(rows.has(created.id)).toBe(true);
    expect(rows.get("update")?.title).toBe("Changed");
    expect(rows.get("respond")?.status).toBe("APPROVED");
    expect(rows.get("counter")).toMatchObject({ status: "COUNTERED", amount: 100, counterAmount: 80 });
    expect(reopened).toMatchObject({ status: "PENDING", amount: 90, counterAmount: null, counterNote: null });
    // Existing sanitization coerces null counterAmount to zero on the next read.
    expect(rows.get("reopen")).toMatchObject({ status: "PENDING", amount: 90, counterAmount: 0, counterNote: null });
    expect(rows.has("delete")).toBe(false);
  });

  it("merges parallel patches to the same record", async () => {
    committed = { approvals: [record("same")] };
    await Promise.all([
      updateClientApprovalById("same", { title: "New title" }),
      updateClientApprovalById("same", { amount: 200 }),
    ]);
    expect(committed!.approvals[0]).toMatchObject({ title: "New title", amount: 200 });
  });

  it.each(["approve", "counter"] as const)("makes approve/counter mutually exclusive when %s arrives first", async (first) => {
    committed = { approvals: [record("same")] };
    const results = await Promise.allSettled(first === "approve"
      ? [approve("same"), counter("same")]
      : [counter("same"), approve("same")]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: new Error("STALE_APPROVAL") });
    expect(committed!.approvals[0]).toMatchObject(first === "approve"
      ? { status: "APPROVED", counterNote: null, respondedByUserId: "user" }
      : { status: "COUNTERED", counterAmount: 80, respondedByUserId: null });
    expect(events.filter((event) => event.endsWith(":write"))).toHaveLength(1);
  });

  it.each(["respond", "counter"] as const)("rejects a queued %s after an admin edit commits", async (action) => {
    committed = { approvals: [record("same")] };
    const expectedVersion = clientApprovalVersion(committed.approvals[0]);
    const results = await Promise.allSettled([
      updateClientApprovalById("same", { amount: 200, metadata: { recipientUserIds: ["replacement"] } }),
      action === "respond"
        ? respondClientApproval({ id: "same", clientId: "client", decision: "APPROVE", respondedByUserId: "user", expectedVersion })
        : counterClientApproval({ id: "same", clientId: "client", amount: 80, counteredByUserId: "user", expectedVersion }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1]).toMatchObject({ status: "rejected", reason: new Error("STALE_APPROVAL") });
    expect(events.indexOf("2:read")).toBeGreaterThan(events.indexOf("1:commit"));
    expect(events).not.toContain("2:write");
    expect(committed.approvals[0]).toMatchObject({ status: "PENDING", amount: 200, metadata: { recipientUserIds: ["replacement"] } });
  });

  it("retains history beyond 1000 records, including concurrent creates", async () => {
    committed = { approvals: Array.from({ length: 1000 }, (_, i) => record(`old-${i}`)) };
    await Promise.all([createClientApproval(input), createClientApproval(input)]);
    expect(committed!.approvals).toHaveLength(1002);
    expect(committed!.approvals.slice(2).map((row) => row.id)).toEqual(
      Array.from({ length: 1000 }, (_, i) => `old-${i}`),
    );
  });
});
