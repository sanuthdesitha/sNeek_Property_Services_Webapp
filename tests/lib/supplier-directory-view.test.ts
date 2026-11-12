/**
 * Suppliers directory read model (board "Suppliers", 2026-11-12): types,
 * tabs, filters, sorting and export; trades as a read model; laundry partner
 * figures from runs (unknown stays unknown); the one-partner-per-login move.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));

import { buildDirectoryEntries, directoryCsv, filterDirectory, readDirectoryTab, tabCounts, DEFAULT_FILTERS } from "@/lib/suppliers/directory-view";
import { moveConfirmText, partnerPatchBody, teamMoves } from "@/lib/suppliers/partner-body";
import { partnerStatsFromRuns } from "@/lib/suppliers/directory-load";
import type { LaundryPartnerRecord, SupplierDirectoryRow, TradeSupplierRecord } from "@/lib/suppliers/directory-types";

const partner = (patch: Partial<LaundryPartnerRecord> = {}): LaundryPartnerRecord => ({
  id: "l1", name: "CleanCo", phone: "02 9555 0140", email: "ops@cleanco.invalid", address: "Alexandria", pricePerKg: 3.2, avgTurnaround: 48, reliabilityScore: null, notes: "keep", isActive: true, stockSupplierId: null,
  team: [{ id: "u1", name: "Tom", email: "tom@x", isActive: true }], runCount: 9, ...patch,
});
const stockRow = (id: string, name: string, categories: string[], isActive = true): SupplierDirectoryRow => ({ key: id, kind: "STOCK", name, laundry: null, stock: { id, name, email: null, phone: "0400", website: null, defaultLeadDays: 1, categories, notes: null, isActive } });
const trade = (patch: Partial<TradeSupplierRecord> = {}): TradeSupplierRecord => ({ id: "w1", name: "Bright Spark", contactName: "Lee", company: "Bright Spark", trade: "Electrical", phone: "0413", email: null, notes: null, isActive: true, isPermanent: true, login: null, openCases: 0, ...patch });

const response = {
  rows: [
    { key: "laundry:l1", kind: "LAUNDRY" as const, name: "CleanCo", stock: null, laundry: partner({ stats: { toPickUp: 1, atLaundry: 2, toDrop: 1, late: 1, onTimePct: 90, measuredRuns: 10, actualAvgHours: 40, recentProperties: 5, chases: [] } }) },
    { key: "laundry:l2", kind: "LAUNDRY" as const, name: "Linen Lab", stock: null, laundry: partner({ id: "l2", name: "Linen Lab", team: [], avgTurnaround: null, pricePerKg: null }) },
    stockRow("s1", "Bondi Hardware", ["Hardware"]),
    stockRow("s2", "Old Paper", ["Paper"], false),
  ],
  trades: [trade(), trade({ id: "w2", name: "Eastside Plumbing", trade: "Plumbing", login: { id: "m1", email: "e@x", isActive: true, lastSeenAt: null }, openCases: 2 })],
};

describe("directory entries", () => {
  const entries = buildDirectoryEntries(response);

  it("gives each type its drawn columns, with unknowns stated", () => {
    const clean = entries.find((entry) => entry.key === "laundry:l1")!;
    expect(clean).toMatchObject({ types: ["LAUNDRY"], terms: "48 h · $3.20/kg", loginsLabel: "1", progressLabel: "4 runs", lateCount: 1, onTimePct: 90 });
    const lab = entries.find((entry) => entry.key === "laundry:l2")!;
    expect(lab).toMatchObject({ terms: "Turnaround not recorded", loginsLabel: "None", progressLabel: "Not available", onTimePct: null });
    expect(lab.attention).toContain("No laundry portal logins");
    expect(entries.find((entry) => entry.key === "s1")).toMatchObject({ types: ["STOCK"], terms: "Lead 1 d", progressLabel: "–" });
    expect(entries.find((entry) => entry.key === "trade:w2")).toMatchObject({ types: ["TRADES"], loginsLabel: "1 login", progressLabel: "2 open cases", terms: "Not recorded", categories: ["Plumbing"] });
  });

  it("counts tabs (types count active only; inactive separately; all is everything)", () => {
    expect(tabCounts(entries)).toEqual({ all: 6, laundry: 2, stock: 1, trades: 2, inactive: 1 });
    expect(readDirectoryTab("trades")).toBe("trades");
    expect(readDirectoryTab("bogus")).toBe("all");
  });

  it("filters by tab, attention, logins, category and search, and sorts with name ties", () => {
    const names = (filters: Partial<typeof DEFAULT_FILTERS>) => filterDirectory(entries, { ...DEFAULT_FILTERS, ...filters }).map((entry) => entry.name);
    expect(names({ tab: "laundry" })).toEqual(["CleanCo", "Linen Lab"]);
    expect(names({ tab: "inactive" })).toEqual(["Old Paper"]);
    expect(names({ attention: true })).toEqual(["CleanCo", "Linen Lab"]);
    expect(names({ withLogins: true })).toEqual(["CleanCo", "Eastside Plumbing"]);
    expect(names({ category: "Plumbing" })).toEqual(["Eastside Plumbing"]);
    expect(names({ q: "tom" })).toEqual(["CleanCo"]);
    expect(names({ sort: "progress", dir: "desc" }).slice(0, 2)).toEqual(["CleanCo", "Eastside Plumbing"]);
    expect(names({ sort: "ontime", dir: "desc" })[0]).toBe("CleanCo");
  });

  it("exports the rows on screen as CSV with quoting", () => {
    const csv = directoryCsv(filterDirectory(entries, { ...DEFAULT_FILTERS, tab: "laundry" }));
    expect(csv.split("\n")[0]).toBe("Supplier,Type,Details,Terms,Portal logins,In progress,On time %,Active");
    expect(csv).toContain("CleanCo,Laundry,ops@cleanco.invalid,48 h · $3.20/kg,1,4 runs,90,Yes");
    expect(csv).toContain("Linen Lab,Laundry,");
  });

  it("keeps older readers working without trades", () => {
    expect(buildDirectoryEntries({ rows: response.rows }).some((entry) => entry.types.includes("TRADES"))).toBe(false);
  });
});

describe("one laundry login, one partner", () => {
  const users = [{ id: "u1", name: "Tom", email: "t@x", isActive: true, laundrySupplierId: "l1" }, { id: "u2", name: null, email: "ana@x", isActive: true, laundrySupplierId: null }];
  const names = new Map([["l1", "CleanCo"]]);

  it("lists the moves a save would make and names the partner each person leaves", () => {
    expect(teamMoves(["u1", "u2"], "l2", users, names)).toEqual([{ userId: "u1", name: "Tom", from: "CleanCo" }]);
    expect(teamMoves(["u1"], "l1", users, names)).toEqual([]);
    expect(moveConfirmText([{ name: "Tom", from: "CleanCo" }], "Linen Lab")).toBe("Tom leaves CleanCo, and joins Linen Lab. A laundry login belongs to one laundry partner only.");
  });

  it("resends the whole partner record with a team change (the route nulls omitted fields)", () => {
    expect(partnerPatchBody(partner(), { teamUserIds: ["u1", "u2"] })).toEqual({
      name: "CleanCo", phone: "02 9555 0140", email: "ops@cleanco.invalid", address: "Alexandria", pricePerKg: 3.2, avgTurnaround: 48, reliabilityScore: null, notes: "keep", isActive: true, teamUserIds: ["u1", "u2"],
    });
    expect(partnerPatchBody(partner())).not.toHaveProperty("teamUserIds");
  });
});

describe("laundry partner figures from runs", () => {
  const now = new Date("2026-11-12T03:00:00Z"); // 14:00 Sydney
  const run = (patch: Record<string, unknown>) => ({ supplierId: "l1", status: "PICKED_UP", pickupDate: new Date("2026-11-11T00:00:00Z"), dropoffDate: new Date("2026-11-14T00:00:00Z"), pickedUpAt: new Date("2026-11-10T01:00:00Z"), droppedAt: null, propertyId: "p1", ...patch }) as never;

  it("counts stages by Sydney day, late against the agreed turnaround, and on-time over 30 days", () => {
    const stats = partnerStatsFromRuns([
      run({}),
      run({ dropoffDate: new Date("2026-11-12T00:00:00Z"), pickedUpAt: new Date("2026-11-12T00:00:00Z"), propertyId: "p2" }),
      run({ status: "CONFIRMED", pickupDate: new Date("2026-11-12T00:00:00Z"), pickedUpAt: null }),
      run({ status: "CONFIRMED", pickupDate: new Date("2026-11-15T00:00:00Z"), pickedUpAt: null }),
      run({ status: "DROPPED", pickedUpAt: new Date("2026-11-01T00:00:00Z"), droppedAt: new Date("2026-11-02T12:00:00Z") }),
      run({ status: "DROPPED", pickedUpAt: new Date("2026-11-03T00:00:00Z"), droppedAt: new Date("2026-11-06T00:00:00Z") }),
    ], 48, now);
    expect(stats).toMatchObject({ toPickUp: 1, atLaundry: 1, toDrop: 1, late: 1, measuredRuns: 2, onTimePct: 50, actualAvgHours: 54, recentProperties: 2 });
  });

  it("never turns an unmeasured figure into zero", () => {
    expect(partnerStatsFromRuns([], null, now)).toMatchObject({ onTimePct: null, actualAvgHours: null, measuredRuns: 0, late: 0 });
    expect(partnerStatsFromRuns([run({ status: "DROPPED", pickedUpAt: new Date("2026-11-01T00:00:00Z"), droppedAt: new Date("2026-11-02T00:00:00Z") })], null, now).onTimePct).toBeNull();
  });
});
