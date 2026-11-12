// @vitest-environment node
/**
 * Parity audit 2026-11-12: the Accounts KPI strip reads getAccountsOverview.
 * A count whose query failed is reported as unavailable (shown as "–"), never
 * as a real zero.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ userFindMany: vi.fn(), userCount: vi.fn(), clientCount: vi.fn(), invoiceFindMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: m.userFindMany, count: m.userCount },
    client: { count: m.clientCount },
    clientInvoice: { findMany: m.invoiceFindMany },
  },
}));

import { getAccountsOverview } from "@/lib/accounts/overview";

beforeEach(() => {
  vi.clearAllMocks();
  m.userFindMany.mockResolvedValue([
    { id: "u1", name: "A", role: "ADMIN", dateOfBirth: null, isActive: true },
    { id: "u2", name: "C", role: "CLEANER", dateOfBirth: null, isActive: true },
  ]);
  m.userCount.mockResolvedValue(1);
  m.clientCount.mockResolvedValue(4);
  m.invoiceFindMany.mockResolvedValue([]);
});

describe("getAccountsOverview", () => {
  it("returns the three headline counts with nothing unavailable", async () => {
    const overview = await getAccountsOverview(30);
    expect(overview).toMatchObject({ totalStaff: 2, activeCleaners: 1, totalClients: 4, unavailable: [] });
  });

  it("names a failed count instead of passing its fallback zero off as real", async () => {
    m.clientCount.mockRejectedValue(new Error("db down"));
    m.userCount.mockRejectedValue(new Error("db down"));
    const overview = await getAccountsOverview(30);
    expect(overview.unavailable.sort()).toEqual(["activeCleaners", "totalClients"]);
    expect(overview.totalStaff).toBe(2);
  });
});
