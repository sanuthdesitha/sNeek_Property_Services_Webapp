/**
 * Cleaner home addresses (board "Cleaner home addresses", 2026-11-17):
 * administrators only, checked before anything is read; every opening is
 * written to the activity log (who, when; never the addresses); the map gets
 * SUBURB-LEVEL pins only (no street, no stored position reaches the browser's
 * map data); honest notes (nothing uses the addresses; the old "for route
 * planning" description is gone); "Ask the N…" is a tier A confirmation that
 * names who will be told.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Role } from "@prisma/client";
import * as React from "react";
import { canActAs } from "@/lib/auth/roles";

const mocks = vi.hoisted(() => ({ requireRole: vi.fn(), findMany: vi.fn(), properties: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: mocks.findMany }, property: { findMany: mocks.properties }, auditLog: { create: mocks.audit } } }));
vi.mock("@/lib/maps/server-key", () => ({ getServerMapsKey: vi.fn(async () => "") }));
vi.mock("@/lib/maps/loader", () => ({ resolveBrowserMapsKey: vi.fn(async () => ""), ensureGoogleMaps: vi.fn(async () => undefined) }));
import Page from "@/app/v2/admin/cleaners/addresses/page";
import { HomeAddressesWorkspace } from "@/components/v2/admin/cleaners/home-addresses-workspace";

const CLEANERS = [
  { id: "c1", name: "Ruby Chen", email: "ruby@x", address: "2 Darling St", suburb: "Balmain", latitude: -33.85871, longitude: 151.17913, preferredTransport: "DRIVING" },
  { id: "c2", name: "Priya Shah", email: "priya@x", address: "5 Church St", suburb: "Parramatta", latitude: -33.81361, longitude: 151.00349, preferredTransport: "DRIVING" },
  { id: "c3", name: "Noah Patel", email: "noah@x", address: null, suburb: "Marrickville", latitude: null, longitude: null, preferredTransport: "TRANSIT" },
  { id: "c4", name: "Ben Carter", email: "ben@x", address: "Unit 2, Maroubra", suburb: "Maroubra", latitude: null, longitude: null, preferredTransport: "DRIVING" },
  { id: "c5", name: "Chloe Martin", email: "chloe@x", address: null, suburb: null, latitude: null, longitude: null, preferredTransport: "DRIVING" },
];
const PROPERTIES = [
  { suburb: "Balmain", latitude: -33.86, longitude: 151.18 },
  { suburb: "Balmain", latitude: -33.854, longitude: 151.176 },
  { suburb: "Marrickville", latitude: -33.91, longitude: 151.155 },
];

type Element = React.ReactElement<Record<string, unknown>>;
function findElement(node: unknown, type: unknown): Element | null {
  if (!node || typeof node !== "object") return null;
  const element = node as Element;
  if (element.type === type) return element;
  const children = (element.props as { children?: unknown } | undefined)?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRole.mockResolvedValue({ user: { id: "admin-1", role: Role.ADMIN } });
  mocks.findMany.mockResolvedValue(CLEANERS);
  mocks.properties.mockResolvedValue(PROPERTIES);
  mocks.audit.mockResolvedValue({});
});

describe("access and the activity log", () => {
  it("checks ADMIN before reading, reads the minimal fields, and records the opening without addresses", async () => {
    render(await Page());
    expect(mocks.requireRole).toHaveBeenCalledWith([Role.ADMIN]);
    expect(mocks.requireRole.mock.invocationCallOrder[0]).toBeLessThan(mocks.findMany.mock.invocationCallOrder[0]);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { isActive: true, OR: [{ role: Role.CLEANER }, { extraRoles: { some: { role: Role.CLEANER } } }] },
      select: { id: true, name: true, email: true, address: true, suburb: true, latitude: true, longitude: true, preferredTransport: true },
      orderBy: [{ suburb: "asc" }, { name: "asc" }, { id: "asc" }],
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    const record = mocks.audit.mock.calls[0][0];
    expect(record.data).toMatchObject({ userId: "admin-1", action: "CLEANER_HOME_ADDRESSES_VIEWED", entity: "CleanerHomeAddresses" });
    const logged = JSON.stringify(record);
    for (const cleaner of CLEANERS) {
      if (cleaner.address) expect(logged).not.toContain(cleaner.address);
      if (cleaner.suburb) expect(logged).not.toContain(cleaner.suburb);
    }
  });

  it("records the real administrator while testing as another administrator", async () => {
    mocks.requireRole.mockResolvedValue({ user: { id: "admin-2", role: Role.ADMIN }, impersonation: { actorId: "admin-1", mode: "READ_ONLY", startedAt: 1 } });
    await Page();
    expect(mocks.audit.mock.calls[0][0].data).toMatchObject({ userId: "admin-1", after: { testingAs: "admin-2" } });
  });

  it.each([Role.OPS_MANAGER, Role.CLEANER, Role.CLIENT])("denies %s before reading or recording anything", async (role) => {
    mocks.requireRole.mockImplementation(async (allowed: Role[]) => {
      if (!canActAs([role], allowed)) throw new Error("FORBIDDEN");
    });
    await expect(Page()).rejects.toThrow("FORBIDDEN");
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("does not show the addresses when the opening cannot be recorded", async () => {
    mocks.audit.mockRejectedValue(new Error("db down"));
    await expect(Page()).rejects.toThrow("db down");
  });
});

describe("what the page says and shows", () => {
  it("leads with the two notes and drops the old route-planning claim", async () => {
    render(await Page());
    expect(screen.getByRole("heading", { level: 1, name: "Cleaner home addresses" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Private: administrators only" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not used for travel or suggestions" })).toBeInTheDocument();
    expect(screen.getByText(/written to the activity log \(who and when, not the addresses\)/)).toBeInTheDocument();
    expect(screen.queryByText(/for route planning\./)).not.toBeInTheDocument();
    expect(screen.getByText("The map is not configured")).toBeInTheDocument();
  });

  it("shows the table with On the map, flags and Not recorded in words", async () => {
    render(await Page());
    const table = screen.getByRole("table");
    const row = (name: string) => within(table).getByText(name).closest("tr") as HTMLElement;
    expect(within(row("Ruby Chen")).getByText("Placed")).toBeInTheDocument();
    expect(within(row("Priya Shah")).getByText("Placed, shown by area")).toBeInTheDocument();
    expect(within(row("Noah Patel")).getByText("No street address")).toBeInTheDocument();
    expect(within(row("Noah Patel")).getByText("Suburb only")).toBeInTheDocument();
    expect(within(row("Ben Carter")).getByText("Could not be placed")).toBeInTheDocument();
    expect(within(row("Ben Carter")).getByText("Not found")).toBeInTheDocument();
    expect(within(row("Chloe Martin")).getAllByText("Not recorded")).toHaveLength(2);
    expect(within(row("Noah Patel")).getByText("Public transport")).toBeInTheDocument();
    expect(within(row("Ruby Chen")).getByRole("link", { name: "Ruby Chen" })).toHaveAttribute("href", "/v2/admin/accounts/users/c1");
    // Phones get the same rows as cards.
    expect(screen.getByRole("list", { name: "Cleaner home addresses" })).toBeInTheDocument();
  });

  it("filters to the three needing attention", async () => {
    render(await Page());
    fireEvent.click(screen.getByRole("button", { name: "Needs attention 3" }));
    const table = screen.getByRole("table");
    expect(within(table).queryByText("Ruby Chen")).not.toBeInTheDocument();
    expect(within(table).getByText("Noah Patel")).toBeInTheDocument();
  });

  it("renders the empty team without a map", async () => {
    mocks.findMany.mockResolvedValue([]);
    render(await Page());
    expect(screen.getByText("No active cleaners")).toBeInTheDocument();
    expect(screen.queryByText("The map is not configured")).not.toBeInTheDocument();
  });
});

describe("suburb-level map data (privacy)", () => {
  it("sends no street address and no stored position in the map pins", async () => {
    const tree = await Page();
    const workspace = findElement(tree, HomeAddressesWorkspace);
    expect(workspace).not.toBeNull();
    const props = workspace!.props as { pins: Array<Record<string, unknown>>; rows: Array<Record<string, unknown>> };
    const pinsJson = JSON.stringify(props.pins);
    for (const cleaner of CLEANERS) {
      if (cleaner.address) expect(pinsJson).not.toContain(cleaner.address);
      if (cleaner.latitude !== null) {
        expect(pinsJson).not.toContain(String(cleaner.latitude));
        expect(pinsJson).not.toContain(String(cleaner.longitude));
      }
    }
    // Rows (the table) carry no coordinates at all.
    for (const row of props.rows) {
      expect(Object.keys(row)).not.toContain("latitude");
      expect(Object.keys(row)).not.toContain("longitude");
    }
    const ruby = props.pins.find((pin) => pin.cleanerId === "c1");
    expect(ruby).toMatchObject({ lat: -33.857, lng: 151.178, basis: "suburb_centre", suburb: "Balmain" });
    const priya = props.pins.find((pin) => pin.cleanerId === "c2");
    expect(priya).toMatchObject({ lat: -33.81, lng: 151.01, basis: "area_square" });
    expect(props.pins.find((pin) => pin.cleanerId === "c3")).toMatchObject({ suburbOnly: true, basis: "suburb_centre" });
    expect(props.pins.map((pin) => pin.cleanerId).sort()).toEqual(["c1", "c2", "c3"]);
  });
});

describe("Ask the N to update their profile", () => {
  const rows = [
    { id: "c3", name: "Noah Patel", address: null, suburb: "Marrickville", status: "suburb_only" as const, flag: "No street address", onTheMap: "Suburb only", transport: "Public transport", accountHref: "/x" },
    { id: "c5", name: "Chloe Martin", address: null, suburb: null, status: "nothing" as const, flag: "Nothing recorded", onTheMap: "No", transport: "Driving", accountHref: "/y" },
    { id: "c1", name: "Ruby Chen", address: "2 Darling St", suburb: "Balmain", status: "placed" as const, flag: null, onTheMap: "Placed", transport: "Driving", accountHref: "/z" },
  ];
  const counts = { active: 3, placed: 1, noAddress: 2, suburbOnly: 1, notFound: 0, attention: 2 };

  it("confirms with tier A naming who will be told, posts only them, and reports each outcome", async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HomeAddressesWorkspace rows={rows} pins={[]} counts={counts} mapConfigured={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Ask the 2 to update their profile…" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Please confirm")).toBeInTheDocument();
    expect(within(dialog).getByText(/An inbox notice goes to Noah Patel and Chloe Martin/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Inbox only: no email, text or phone push/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send 2 inbox notices" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/cleaners/addresses/update-request", expect.objectContaining({ method: "POST", body: JSON.stringify({ cleanerIds: ["c3", "c5"] }) }));
    await act(async () => {
      resolve({ ok: true, status: 200, json: async () => ({ outcomes: [{ userId: "c3", name: "Noah Patel", state: "inbox_available" }, { userId: "c5", name: "Chloe Martin", state: "already_asked_today" }] }) });
    });
    expect(screen.getByText("Noah Patel: in their inbox")).toBeInTheDocument();
    expect(screen.getByText("Chloe Martin: already asked today, not asked again")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
