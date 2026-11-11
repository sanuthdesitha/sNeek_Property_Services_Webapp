// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ properties: vi.fn(), task: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { property: { findMany: m.properties }, laundryTask: { findUnique: m.task } } }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { filterTasksVisibleToUser } from "@/lib/laundry/week-feed";
import {
  NO_VISIBLE_LAUNDRY_PROPERTY,
  isLaundryOfficeRole,
  resolveLaundryInvoiceScope,
} from "@/lib/laundry/teams";

const guide = [
  { id: "lockbox", label: "Lockbox 4729", audience: "CLEANER" },
  { id: "dock", label: "Laundry dock", audience: "LAUNDRY" },
  { id: "gate", label: "Front gate", audience: "BOTH" },
];
const task = (accessInfo: Record<string, unknown> = {}) => ({
  id: "t1",
  property: {
    laundryEnabled: true, accessInfo, accessGuide: guide,
    client: { id: "c1", name: "Harbour View", email: "owner@example.test" },
  },
});

beforeEach(() => vi.clearAllMocks());

describe("what a laundry viewer receives", () => {
  it("leaves office roles unrestricted", () => {
    const [row] = filterTasksVisibleToUser([task()], "ADMIN" as any, "office");
    expect((row.property as any).accessGuide).toHaveLength(3);
    expect((row.property as any).client.email).toBe("owner@example.test");
    expect(isLaundryOfficeRole("OPS_MANAGER")).toBe(true);
  });

  it("sends the same access steps a cleaner sees, without the client's email", () => {
    const [row] = filterTasksVisibleToUser([task()], "LAUNDRY" as any, "driver");
    expect((row.property as any).accessGuide.map((entry: any) => entry.id)).toEqual(["lockbox", "dock", "gate"]);
    expect((row.property as any).client).toEqual({ id: "c1", name: "Harbour View" });
  });

  it("drops a malformed guide entry rather than sending it", () => {
    const withJunk = task();
    (withJunk.property.accessGuide as unknown[]).push("not-an-entry", null);
    const [row] = filterTasksVisibleToUser([withJunk], "LAUNDRY" as any, "driver");
    expect((row.property as any).accessGuide).toHaveLength(3);
  });

  it("scopes anyone who is not acting as office staff, whatever their active role", () => {
    const teamOnly = task({ laundryTeamUserIds: ["someone-else"] });
    expect(filterTasksVisibleToUser([teamOnly], "CLEANER" as any, "driver")).toEqual([]);
    expect(isLaundryOfficeRole("CLEANER")).toBe(false);
    expect(isLaundryOfficeRole("LAUNDRY")).toBe(false);
  });
});

describe("laundry invoice scope", () => {
  const visible = (ids: string[]) =>
    m.properties.mockResolvedValue(ids.map((id) => ({ id, accessInfo: {}, laundryEnabled: true })));

  it("never widens to every property when nothing requested is visible", async () => {
    visible(["mine"]);
    expect(await resolveLaundryInvoiceScope("LAUNDRY" as any, "driver", { propertyIds: ["not-mine"] })).toEqual({
      ok: true, propertyIds: [NO_VISIBLE_LAUNDRY_PROPERTY],
    });
  });

  it("returns nothing for a driver who serves no property", async () => {
    visible([]);
    expect(await resolveLaundryInvoiceScope("LAUNDRY" as any, "driver", {})).toEqual({
      ok: true, propertyIds: [NO_VISIBLE_LAUNDRY_PROPERTY],
    });
  });

  it("narrows an unscoped request to the visible properties", async () => {
    visible(["mine", "also-mine"]);
    expect(await resolveLaundryInvoiceScope("LAUNDRY" as any, "driver", {})).toEqual({
      ok: true, propertyIds: ["mine", "also-mine"],
    });
  });

  it("scopes a multi-role account that is not acting as office staff", async () => {
    visible(["mine"]);
    const scope = await resolveLaundryInvoiceScope("CLEANER" as any, "driver", { propertyId: "not-mine" });
    expect(scope).toEqual({ ok: false });
  });

  it("leaves office roles unrestricted", async () => {
    expect(await resolveLaundryInvoiceScope("ADMIN" as any, "office", { propertyIds: ["any"] })).toEqual({ ok: true });
    expect(m.properties).not.toHaveBeenCalled();
  });
});
