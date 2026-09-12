// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), settings: vi.fn(), user: vi.fn(), people: vi.fn(), jobs: vi.fn(),
  properties: vi.fn(), invoices: vi.fn(), maintenance: vi.fn(), laundry: vi.fn(), settingRow: vi.fn(),
  defaults: { clientPortalVisibility: { showJobs: true, showProperties: true, showFinanceDetails: true },
    cleanerPortalVisibility: { showJobs: true } },
}));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/settings", () => ({ DEFAULT_SETTINGS: mocks.defaults, getAppSettings: mocks.settings }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findUnique: mocks.user, findMany: mocks.people }, job: { findMany: mocks.jobs },
  property: { findMany: mocks.properties }, clientInvoice: { findMany: mocks.invoices },
  propertyMaintenanceItem: { findMany: mocks.maintenance }, appSetting: { findUnique: mocks.settingRow },
  laundryTask: { findMany: mocks.laundry },
} }));

import { GET } from "@/app/api/portal/search/route";
import { literalSearchText } from "@/lib/portal/search";

const request = (q?: string) => GET(new Request(`http://localhost/api/portal/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`));
const actor = (role: Role) => mocks.session.mockResolvedValue({ user: { id: "actor", role, heldRoles: [role, Role.ADMIN] } });
const finders = () => [mocks.jobs, mocks.properties, mocks.people, mocks.invoices, mocks.maintenance, mocks.laundry];
const lastWhere = (mock: ReturnType<typeof vi.fn>) => mock.mock.lastCall![0].where;

beforeEach(() => {
  vi.resetAllMocks();
  actor(Role.ADMIN);
  mocks.settings.mockImplementation(async () => structuredClone(mocks.defaults));
  mocks.settingRow.mockResolvedValue(null);
  mocks.user.mockResolvedValue({ id: "actor", name: "Client", email: "a@example.com", clientId: "client-a",
    client: { id: "client-a", portalVisibilityOverrides: null } });
  finders().forEach(fn => fn.mockResolvedValue([]));
});

function va(propertyIds: unknown = ["allowed"], permissions: unknown = { properties: true, invoicesView: true }) {
  actor(Role.VA);
  mocks.user.mockResolvedValue({ id: "actor", name: "VA", clientId: "wrong-client",
    vaTeam: { id: "team", name: "Team", isActive: true, clientId: "client-a", permissions, propertyIds,
      client: { id: "client-a", name: "Client", portalVisibilityOverrides: null } } });
}

describe("portal search authorization and query boundaries", () => {
  it.each([Role.ADMIN, Role.OPS_MANAGER])("provides four bounded groups for %s", async role => {
    actor(role);
    const response = await request("100%_\\literal");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ groups: [
      { id: "jobs", label: "Jobs", items: [] }, { id: "properties", label: "Properties", items: [] },
      { id: "people", label: "People", items: [] }, { id: "invoices", label: "Invoices", items: [] },
    ] });
    for (const fn of finders().slice(0, 4)) {
      expect(fn.mock.lastCall![0]).toMatchObject({ take: 8 });
      expect(fn.mock.lastCall![0].orderBy.at(-1)).toEqual({ id: "asc" });
      expect(fn.mock.lastCall![0]).not.toHaveProperty("include");
    }
    expect(lastWhere(mocks.jobs).AND[1].OR[0]).toEqual({ jobNumber: { contains: "100\\%\\_\\\\literal", mode: "insensitive" } });
    expect(lastWhere(mocks.properties).AND[0]).toEqual({ isActive: true });
    expect(lastWhere(mocks.people).isActive).toBe(true);
  });

  it.each([undefined, "", "   "])("empty query %s returns ordered recents without LIKE", async query => {
    await request(query);
    expect(lastWhere(mocks.jobs)).toEqual({ AND: [{}] });
    expect(mocks.jobs.mock.lastCall![0].orderBy).toEqual([{ updatedAt: "desc" }, { id: "asc" }]);
  });

  it("accepts 100 characters, rejects 101 before searching", async () => {
    expect((await request("x".repeat(100))).status).toBe(200);
    finders().forEach(fn => fn.mockClear());
    expect((await request(" ".repeat(101))).status).toBe(400);
    finders().forEach(fn => expect(fn).not.toHaveBeenCalled());
    expect(literalSearchText("a' OR 1=1 --%_\\").contains).toBe("a' OR 1=1 --\\%\\_\\\\");
  });

  it.each(["UNAUTHORIZED", "FORBIDDEN"])("%s never searches", async error => {
    mocks.session.mockRejectedValue(new Error(error));
    const response = await request();
    expect(response.status).toBe(error === "UNAUTHORIZED" ? 401 : 403);
    expect(await response.json()).toEqual({ error });
    finders().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("rejects unknown active roles even with a held admin role", async () => {
    actor("UNKNOWN" as Role);
    expect((await request()).status).toBe(403);
    finders().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("cleaners are limited to nonremoved assignments and nonskipped jobs", async () => {
    actor(Role.CLEANER);
    expect((await request()).status).toBe(200);
    expect(lastWhere(mocks.jobs).AND[0]).toEqual({ assignments: { some: { userId: "actor", removedAt: null } }, cleanSkipStatus: { not: "SKIPPED" } });
    expect(mocks.people).not.toHaveBeenCalled();
    expect(mocks.properties).not.toHaveBeenCalled();
    expect(mocks.invoices).not.toHaveBeenCalled();
  });

  it("honors client ownership, active properties, history and invoice release", async () => {
    actor(Role.CLIENT);
    await request();
    expect(lastWhere(mocks.jobs).AND[0]).toMatchObject({ property: { clientId: "client-a" }, scheduledDate: { gte: expect.any(Date) } });
    expect(lastWhere(mocks.properties).AND[0]).toEqual({ clientId: "client-a", isActive: true });
    expect(lastWhere(mocks.invoices).AND[0]).toEqual({ clientId: "client-a", status: { notIn: ["DRAFT", "VOID"] } });
    expect(mocks.people).not.toHaveBeenCalled();
  });

  it.each([{ scope: ["allowed"] }, { scope: ["allowed", "also-allowed"] }])("preserves VA property scope $scope and excludes mixed invoices", async ({ scope }) => {
    va(scope);
    await request("Bay");
    const property = { clientId: "client-a", id: { in: scope } };
    expect(lastWhere(mocks.jobs).AND[0].property).toEqual(property);
    expect(lastWhere(mocks.properties).AND[0]).toEqual({ ...property, isActive: true });
    expect(lastWhere(mocks.invoices).AND[0]).toEqual({ clientId: "client-a", status: { notIn: ["DRAFT", "VOID"] },
      lines: { some: {}, every: { job: { property } } } });
    expect(mocks.people).not.toHaveBeenCalled();
  });

  it("retains the existing VA parser's empty-scope meaning: all properties of its client", async () => {
    va([]);
    await request();
    expect(lastWhere(mocks.jobs).AND[0].property).toEqual({ clientId: "client-a" });
    expect(lastWhere(mocks.invoices).AND[0]).toEqual({ clientId: "client-a", status: { notIn: ["DRAFT", "VOID"] } });
  });

  it.each([{}, { properties: false, invoicesView: false }, "invalid"])("VA grants %j do not enable properties or finance", async grants => {
    va(["allowed"], grants);
    expect((await request()).status).toBe(200);
    expect(mocks.jobs).toHaveBeenCalledOnce();
    expect(mocks.properties).not.toHaveBeenCalled();
    expect(mocks.invoices).not.toHaveBeenCalled();
  });

  it.each([null, { isActive: false }, { isActive: true, client: null }])("denies unresolved VA team %j", async team => {
    va();
    mocks.user.mockResolvedValue({ clientId: "fallback-must-not-work", vaTeam: team });
    expect((await request()).status).toBe(403);
    finders().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("per-client hidden modules deny search without querying records", async () => {
    actor(Role.CLIENT);
    mocks.user.mockResolvedValue({ id: "actor", clientId: "client-a", client: { portalVisibilityOverrides:
      { showJobs: false, showProperties: false, showFinanceDetails: false } } });
    expect((await request()).status).toBe(403);
    finders().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("disabled cleaner jobs deny search", async () => {
    actor(Role.CLEANER);
    mocks.settings.mockResolvedValue({ cleanerPortalVisibility: { showJobs: false } });
    expect((await request()).status).toBe(403);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it("QA requires ownership and excludes foreign active assignments even alongside an owned one", async () => {
    actor(Role.QA_INSPECTOR);
    await request("Bay");
    expect(lastWhere(mocks.jobs).AND[0]).toEqual({ qaAssignments: {
      some: { OR: [{ assignedToId: "actor" }, { pickedUpById: "actor" }], status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED"] } },
      none: { status: { notIn: ["CANCELLED", "COMPLETED"] }, assignedToId: { not: "actor" },
        AND: [{ assignedToId: { not: null } }, { OR: [{ pickedUpById: null }, { pickedUpById: { not: "actor" } }] }] },
    } });
    expect(mocks.people).not.toHaveBeenCalled();
  });

  it("maintenance requires the worker linked to this user", async () => {
    actor(Role.MAINTENANCE);
    await request("Bay");
    expect(lastWhere(mocks.maintenance).assignedWorker).toEqual({ userId: "actor" });
    expect(mocks.jobs).not.toHaveBeenCalled();
  });

  it("laundry uses the existing membership parser and only searches visible tracking tasks", async () => {
    actor(Role.LAUNDRY);
    mocks.properties.mockResolvedValue([
      { id: "mine", laundryEnabled: true, accessInfo: { laundryTeamUserIds: ["actor"] } },
      { id: "shared", laundryEnabled: true, accessInfo: null },
      { id: "foreign", laundryEnabled: true, accessInfo: { laundryTeamUserIds: ["other"] } },
      { id: "disabled", laundryEnabled: false, accessInfo: { laundryTeamUserIds: ["actor"] } },
    ]);
    mocks.laundry.mockResolvedValue([{ id: "task /?#", property: { name: "Bay", suburb: null } }]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(lastWhere(mocks.laundry)).toMatchObject({ propertyId: { in: ["mine", "shared"] },
      noPickupRequired: false, status: { not: "SKIPPED_PICKUP" },
      AND: [{ OR: [{ pickupDate: { gte: expect.any(Date), lt: expect.any(Date) } },
        { dropoffDate: { gte: expect.any(Date), lt: expect.any(Date) } }, { status: "FLAGGED" }] }],
    });
    expect(mocks.laundry.mock.lastCall![0]).toMatchObject({ take: 8,
      select: { id: true, property: { select: { name: true, suburb: true } } } });
    expect(await response.json()).toEqual({ groups: [{ id: "jobs", label: "Laundry jobs", items: [
      { id: "task /?#", label: "Bay", href: "/v2/laundry/tracking#task-task%20%2F%3F%23" },
    ] }] });
    expect(mocks.jobs).not.toHaveBeenCalled();
    expect(mocks.invoices).not.toHaveBeenCalled();
  });

  it.each(["properties", "laundry"] as const)("laundry %s failure returns 503", async name => {
    actor(Role.LAUNDRY);
    mocks[name].mockRejectedValue(new Error("membership or task lookup failed"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Search is currently unavailable." });
    if (name === "properties") expect(mocks.laundry).not.toHaveBeenCalled();
  });
});

describe("portal search DTO, destinations and failures", () => {
  it.each([Role.ADMIN, Role.OPS_MANAGER, Role.CLIENT, Role.VA, Role.CLEANER, Role.QA_INSPECTOR, Role.MAINTENANCE])("returns safe bounded DTOs and existing destinations for %s", async role => {
    actor(role);
    if (role === Role.VA) va();
    const secret = { accessCode: "secret", financialNotes: "private", totalAmount: 999, email: "private@example.com" };
    mocks.jobs.mockResolvedValue([{ ...secret, id: "job /?#", jobNumber: "J01", property: { name: "Bay" } }]);
    mocks.properties.mockResolvedValue([{ ...secret, id: "p", name: "P".repeat(600), suburb: null }]);
    mocks.people.mockResolvedValue([{ ...secret, id: "u", name: null }]);
    mocks.invoices.mockResolvedValue([{ ...secret, id: "i", invoiceNumber: "INV-01" }]);
    mocks.maintenance.mockResolvedValue([{ ...secret, id: "m", title: "Fix", property: { name: "Bay" } }]);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(Object.keys(data)).toEqual(["groups"]);
    expect(data.groups.length).toBeLessThanOrEqual(4);
    for (const group of data.groups) {
      expect(Object.keys(group).sort()).toEqual(["id", "items", "label"]);
      expect(group.items.length).toBeLessThanOrEqual(8);
      for (const result of group.items) {
        expect(Object.keys(result).every(key => ["id", "label", "description", "href"].includes(key))).toBe(true);
        expect(result.label.length).toBeLessThanOrEqual(500);
        expect(result.description === undefined || typeof result.description === "string").toBe(true);
        expect(result.href).toMatch(/^\/v2\/(admin|client|cleaner|qa|maintenance)\//);
        const pathname = new URL(result.href, "http://localhost").pathname;
        const page = pathname.replace(/\/(jobs|properties|users|visits|invoices)\/[^/]+$/, "/$1/[id]");
        // Invoice detail pages are owned by the parent change; pin their agreed
        // URLs below without making this isolated backend suite depend on them.
        if (group.id !== "invoices") expect(existsSync(resolve(process.cwd(), `app${page}/page.tsx`))).toBe(true);
      }
    }
    const job = data.groups.find((group: { id: string }) => group.id === "jobs").items[0];
    const portal = role === Role.ADMIN || role === Role.OPS_MANAGER ? "admin" : role === Role.CLIENT || role === Role.VA ? "client" : role === Role.QA_INSPECTOR ? "qa" : role.toLowerCase();
    expect(job.href).toBe(role === Role.MAINTENANCE ? "/v2/maintenance/visits/m" : `/v2/${portal}/jobs/job%20%2F%3F%23`);
    const invoice = data.groups.find((group: { id: string }) => group.id === "invoices");
    if (invoice) expect(invoice.items[0].href).toBe(`/v2/${portal}/finance/invoices/i`);
  });

  it.each(["jobs", "properties", "people", "invoices", "session"] as const)("%s failure returns private 503 without partial data or database details", async name => {
    mocks[name].mockRejectedValue(new Error("database host secret.internal failed"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Search is currently unavailable." });
  });

  it("detects swallowed settings failures before searching", async () => {
    actor(Role.CLIENT);
    mocks.settings.mockResolvedValue(mocks.defaults);
    mocks.settingRow.mockResolvedValue({ key: "app" });
    expect((await request()).status).toBe(503);
    finders().forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it("settings verification database failure is not an empty success", async () => {
    actor(Role.CLEANER);
    mocks.settings.mockResolvedValue(mocks.defaults);
    mocks.settingRow.mockRejectedValue(new Error("database unavailable"));
    expect((await request()).status).toBe(503);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
});
