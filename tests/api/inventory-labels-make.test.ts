// @vitest-environment node
/**
 * Making shelf labels is all or nothing (board "Shelf labels": "nothing is
 * half made"): a code collision retries the WHOLE batch with fresh codes;
 * any other failure makes none and says so. Items already labelled for the
 * place are skipped (a label is never made twice). Rights unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const m = vi.hoisted(() => ({ requireRole: vi.fn(), existing: [] as Array<{ itemId: string }>, txAttempts: 0, failWith: [] as unknown[], created: [] as unknown[] }));

vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/db", () => ({
  db: {
    inventoryItem: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, name: `Item ${id}` }))) },
    property: { findUnique: vi.fn(async () => ({ id: "p-bondi" })) },
    itemBarcode: { findMany: vi.fn(async () => m.existing) },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      m.txAttempts += 1;
      const failure = m.failWith.shift();
      const rows: unknown[] = [];
      const tx = { itemBarcode: { create: vi.fn(async ({ data }: { data: { itemId: string; code: string } }) => {
        const row = { id: `l-${data.itemId}`, code: data.code, packSize: 1, createdAt: new Date(), item: { id: data.itemId, name: `Item ${data.itemId}`, unit: null }, property: null };
        rows.push(row);
        return row;
      }) } };
      const result = await work(tx);
      if (failure) throw failure;
      m.created.push(...rows);
      return result;
    }),
  },
}));

import { POST } from "@/app/api/admin/inventory/labels/route";

const post = (body: unknown) => POST(new Request("http://localhost/api/admin/inventory/labels", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  vi.clearAllMocks();
  m.existing = [];
  m.txAttempts = 0;
  m.failWith = [];
  m.created = [];
  m.requireRole.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
});

describe("POST /api/admin/inventory/labels", () => {
  it("skips items already labelled for the place and makes the rest in one transaction", async () => {
    m.existing = [{ itemId: "b" }];
    const response = await post({ itemIds: ["a", "b", "c"], propertyId: "p-bondi" });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.created.map((row: { id: string }) => row.id)).toEqual(["l-a", "l-c"]);
    expect(body.skipped).toBe(1);
    expect(m.txAttempts).toBe(1);
    expect(m.requireRole).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });

  it("retries the whole batch with fresh codes after a code collision", async () => {
    m.failWith = [Object.assign(new Error("Unique constraint"), { code: "P2002" })];
    const response = await post({ itemIds: ["a", "c"] });
    expect(response.status).toBe(201);
    expect(m.txAttempts).toBe(2);
    expect((await response.json()).created).toHaveLength(2);
    expect(m.created).toHaveLength(2);
  });

  it("makes none and says so when the batch fails for another reason", async () => {
    m.failWith = [new Error("connection lost")];
    const response = await post({ itemIds: ["a", "c"] });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The labels were not made." });
    expect(m.created).toEqual([]);
    expect(m.txAttempts).toBe(1);
  });

  it("refuses without the role before reading anything", async () => {
    m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
    const response = await post({ itemIds: ["a"] });
    expect(response.status).toBe(403);
  });
});
