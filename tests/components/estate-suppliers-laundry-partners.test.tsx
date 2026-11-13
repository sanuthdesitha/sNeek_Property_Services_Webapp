/**
 * Inventory › Suppliers as drawn (board "Suppliers", 2026-11-12; replaces the
 * 2026-11-12 list test on purpose): one directory of laundry partners, stock
 * suppliers and trades with type tabs, filters and columns; the side panel per
 * type; a partner edited through the existing route with the "one laundry
 * login, one partner" move confirmation; a load failure with Retry.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ params: new URLSearchParams("tab=suppliers"), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => "/v2/admin/inventory",
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { EstateSuppliers } from "@/components/v2/admin/inventory/estate-suppliers";

beforeEach(() => {
  nav.params = new URLSearchParams("tab=suppliers");
  nav.replace.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const stats = (patch: Record<string, unknown> = {}) => ({ toPickUp: 1, atLaundry: 3, toDrop: 3, late: 1, onTimePct: 92, measuredRuns: 12, actualAvgHours: 41, recentProperties: 14, chases: [], ...patch });
const stock = (id: string, name: string, categories = ["Linen"]) => ({ id, name, email: `${id}@stock.invalid`, phone: null, website: "example.invalid", defaultLeadDays: 2, categories, notes: null, isActive: true });
const partner = (id: string, name: string, stockSupplierId: string | null, team: Array<Record<string, unknown>>, patch: Record<string, unknown> = {}) => ({
  id, name, phone: "02 9000 0000", email: `${id}@laundry.invalid`, address: null, pricePerKg: 3.2, avgTurnaround: 48, reliabilityScore: 4, notes: null, isActive: true, stockSupplierId, team, runCount: 7, stats: stats(), ...patch,
});
const directory = {
  rows: [
    { key: "laundry:l2", kind: "LAUNDRY", name: "Bubbles", stock: null, laundry: partner("l2", "Bubbles", null, [], { avgTurnaround: null, stats: stats({ late: 0, onTimePct: null, toPickUp: 0, atLaundry: 0, toDrop: 0 }) }) },
    { key: "s1", kind: "BOTH", name: "CleanCo", stock: stock("s1", "CleanCo"), laundry: partner("l1", "CleanCo", "s1", [{ id: "u1", name: "Tom Becker", email: "tom@x", isActive: true, lastSeenAt: new Date().toISOString() }, { id: "u3", name: "Dev Patel", email: "dev@x", isActive: true, invitedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }]) },
    { key: "s2", kind: "STOCK", name: "Harbour Hygiene", stock: stock("s2", "Harbour Hygiene", ["Chemicals"]), laundry: null },
  ],
  trades: [{ id: "w1", name: "Eastside Plumbing", contactName: "Sam", company: "Eastside Plumbing", trade: "Plumbing", phone: "0412 880 314", email: null, notes: null, isActive: true, isPermanent: true, login: { id: "m1", email: "sam@x", isActive: true, lastSeenAt: null }, openCases: 1 }],
  laundryUsers: [
    { id: "u1", name: "Tom Becker", email: "tom@x", isActive: true, laundrySupplierId: "l1" },
    { id: "u2", name: "Ana", email: "ana@x", isActive: true, laundrySupplierId: null },
    { id: "u3", name: "Dev Patel", email: "dev@x", isActive: true, laundrySupplierId: "l1" },
  ],
  danglingLinks: [],
};

function stubDirectory(handler?: (url: string, init?: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler?.(url, init) ?? new Response(JSON.stringify(directory), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Suppliers directory", () => {
  it("lists laundry partners, stock suppliers and trades with the drawn columns and tab counts", async () => {
    stubDirectory();
    render(<EstateSuppliers />);
    expect(await screen.findByRole("heading", { level: 1, name: "Suppliers" })).toBeInTheDocument();
    const clean = (await screen.findByText("CleanCo")).closest("tr") as HTMLElement;
    expect(within(clean).getByText("Laundry")).toBeInTheDocument();
    expect(within(clean).getByText("Stock")).toBeInTheDocument();
    expect(within(clean).getByText("48 h · $3.20/kg · Lead 2 d")).toBeInTheDocument();
    expect(within(clean).getByText("2 · 1 invited")).toBeInTheDocument();
    expect(within(clean).getByText("1 late")).toBeInTheDocument();
    expect(within(clean).getByText("92%")).toBeInTheDocument();
    const plumbing = screen.getByText("Eastside Plumbing").closest("tr") as HTMLElement;
    expect(within(plumbing).getByText("Trades")).toBeInTheDocument();
    expect(within(plumbing).getByText("1 login")).toBeInTheDocument();
    expect(within(plumbing).getByText("1 open case")).toBeInTheDocument();
    expect(within(screen.getByText("Bubbles").closest("tr") as HTMLElement).getByText("–")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All 4" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Laundry partners 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Stock suppliers 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trades and maintenance 1" })).toBeInTheDocument();
  });

  it("filters by type tab, attention, portal logins, category and search", async () => {
    stubDirectory();
    render(<EstateSuppliers />);
    await screen.findByText("CleanCo");
    fireEvent.click(screen.getByRole("tab", { name: "Trades and maintenance 1" }));
    expect(screen.queryByText("CleanCo")).toBeNull();
    expect(screen.getByText("Eastside Plumbing")).toBeInTheDocument();
    expect(nav.replace).toHaveBeenCalledWith("/v2/admin/inventory?tab=suppliers&type=trades", { scroll: false });
    fireEvent.click(screen.getByRole("tab", { name: "All 4" }));
    fireEvent.click(screen.getByRole("button", { name: /^Needs attention/ }));
    // CleanCo has a late run; Bubbles has no portal logins.
    expect(screen.getByText("CleanCo")).toBeInTheDocument();
    expect(screen.getByText("Bubbles")).toBeInTheDocument();
    expect(screen.queryByText("Harbour Hygiene")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Needs attention/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Has portal logins/ }));
    expect(screen.queryByText("Bubbles")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Has portal logins/ }));
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Chemicals" } });
    expect(screen.getByText("Harbour Hygiene")).toBeInTheDocument();
    expect(screen.queryByText("CleanCo")).toBeNull();
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Search suppliers"), { target: { value: "dev patel" } });
    expect(screen.getByText("CleanCo")).toBeInTheDocument();
    expect(screen.queryByText("Bubbles")).toBeNull();
  });

  it("opens a laundry partner panel with logins, turnaround, runs and the one-partner move", async () => {
    nav.params = new URLSearchParams("tab=suppliers&open=s1");
    const fetchMock = stubDirectory((_url, init) => (init?.method === "PATCH" ? new Response(JSON.stringify({ supplier: { id: "l1" } }), { status: 200 }) : undefined));
    render(<EstateSuppliers />);
    const panel = await screen.findByLabelText("Supplier: CleanCo");
    expect(within(panel).getByText("Laundry partner · Stock supplier")).toBeInTheDocument();
    expect(within(panel).getByText("Agreed 48 h · actual 41 h on average (12 runs, 30 days)")).toBeInTheDocument();
    expect(within(panel).getByText("14 with runs in the last 60 days")).toBeInTheDocument();
    expect(within(panel).getByText(/Invited 2 days ago/)).toBeInTheDocument();
    expect(within(panel).getByText("3 at the laundry")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open in Laundry" })).toHaveAttribute("href", "/v2/admin/laundry?supplier=l1");
    fireEvent.click(within(panel).getByRole("button", { name: "Link an existing laundry login" }));
    const dialog = await screen.findByRole("dialog", { name: "Link a laundry login to CleanCo" });
    fireEvent.change(within(dialog).getByLabelText("Laundry login"), { target: { value: "u2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Link login" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, call]) => call?.method === "PATCH")!;
    expect(url).toBe("/api/admin/laundry/suppliers/l1");
    // The whole record is resent with the team (the route nulls omitted fields).
    expect(JSON.parse(String(init!.body))).toMatchObject({ name: "CleanCo", pricePerKg: 3.2, avgTurnaround: 48, teamUserIds: ["u1", "u3", "u2"] });
  });

  it("names the partner a login leaves before moving it, in the partner editor", async () => {
    const fetchMock = stubDirectory((_url, init) => (init?.method === "PATCH" ? new Response(JSON.stringify({ supplier: { id: "l2" } }), { status: 200 }) : undefined));
    render(<EstateSuppliers />);
    const bubbles = (await screen.findByText("Bubbles")).closest("tr") as HTMLElement;
    fireEvent.click(within(bubbles).getByRole("button", { name: "More for Bubbles" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit laundry partner" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Same business as"), { target: { value: "s2" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Tom Becker/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save partner" }));
    expect(await within(dialog).findByText(/Tom Becker leaves CleanCo, and joins Bubbles\. A laundry login belongs to one laundry partner only\./)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Move and continue" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save with the move" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([, call]) => call?.method === "PATCH")!;
    expect(JSON.parse(String(init!.body))).toMatchObject({ name: "Bubbles", stockSupplierId: "s2", teamUserIds: ["u1"] });
  });

  it("shows a trade as a read model with its login and open cases, edited in Maintenance", async () => {
    nav.params = new URLSearchParams("tab=suppliers&open=trade:w1");
    stubDirectory();
    render(<EstateSuppliers />);
    const panel = await screen.findByLabelText("Supplier: Eastside Plumbing");
    expect(within(panel).getByText("sam@x")).toBeInTheDocument();
    expect(within(panel).getByText(/1 assigned and not resolved/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open Maintenance" })).toHaveAttribute("href", "/v2/admin/maintenance");
  });

  it("shows a load failure with Retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 })));
    render(<EstateSuppliers />);
    expect(await screen.findByRole("alert")).toHaveTextContent("FORBIDDEN");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
