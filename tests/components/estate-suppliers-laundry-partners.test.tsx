/**
 * Inventory › Suppliers with laundry partners (2026-11-12): partners listed
 * as "Laundry partner" beside stock suppliers with contact, turnaround, team
 * and a runs link; a linked pair is one row; a partner is edited (linked to
 * the stock supplier of the same business, team set) from the list; a load
 * failure is shown with Retry.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { EstateSuppliers } from "@/components/v2/admin/inventory/estate-suppliers";

afterEach(() => vi.unstubAllGlobals());

const stock = (id: string, name: string) => ({ id, name, email: null, phone: null, website: null, defaultLeadDays: 2, categories: ["Linen"], notes: null, isActive: true });
const partner = (id: string, name: string, stockSupplierId: string | null, team: Array<{ id: string; name: string; email: string; isActive: boolean }>) => ({
  id, name, phone: "02 9000 0000", email: `${id}@laundry.invalid`, address: null, pricePerKg: 4.5, avgTurnaround: null, reliabilityScore: 4, notes: null, isActive: true, stockSupplierId, team, runCount: 7,
});
const directory = {
  rows: [
    { key: "laundry:l2", kind: "LAUNDRY", name: "Bubbles", stock: null, laundry: partner("l2", "Bubbles", null, []) },
    { key: "s1", kind: "BOTH", name: "Fresh Linen", stock: stock("s1", "Fresh Linen"), laundry: partner("l1", "Fresh Linen", "s1", [{ id: "u1", name: "Tom", email: "tom@x", isActive: true }]) },
    { key: "s2", kind: "STOCK", name: "Paper Co", stock: stock("s2", "Paper Co"), laundry: null },
  ],
  laundryUsers: [{ id: "u1", name: "Tom", email: "tom@x", isActive: true, laundrySupplierId: "l1" }, { id: "u2", name: "Ana", email: "ana@x", isActive: true, laundrySupplierId: null }],
  danglingLinks: [],
};

describe("Suppliers list with laundry partners", () => {
  it("shows partners with type, turnaround, team and runs link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(directory), { status: 200 })));
    render(<EstateSuppliers />);
    const bubbles = (await screen.findByText("Bubbles")).closest("tr") as HTMLElement;
    expect(within(bubbles).getByText("Laundry partner")).toBeInTheDocument();
    expect(within(bubbles).getByText(/Turnaround not recorded/)).toBeInTheDocument();
    expect(within(bubbles).getByText("No laundry portal users linked")).toBeInTheDocument();
    expect(within(bubbles).getByRole("link", { name: "Laundry runs (7)" })).toHaveAttribute("href", "/v2/admin/laundry?supplier=l2");
    const fresh = screen.getByText("Fresh Linen").closest("tr") as HTMLElement;
    expect(within(fresh).getByText("Stock supplier · Laundry partner")).toBeInTheDocument();
    expect(within(fresh).getByText("Team: Tom")).toBeInTheDocument();
    expect(within(screen.getByText("Paper Co").closest("tr") as HTMLElement).getByText("Stock supplier")).toBeInTheDocument();
  });

  it("links a partner to the stock supplier of the same business and sets its team", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => (init?.method ? new Response(JSON.stringify({ supplier: { id: "l2" } }), { status: 200 }) : new Response(JSON.stringify(directory), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    render(<EstateSuppliers />);
    const bubbles = (await screen.findByText("Bubbles")).closest("tr") as HTMLElement;
    fireEvent.click(within(bubbles).getByRole("button", { name: /Edit/ }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByLabelText("Same business as") as HTMLSelectElement;
    // Fresh Linen's stock record is already linked to another partner.
    expect(within(select).getByRole("option", { name: /Fresh Linen \(linked to Fresh Linen\)/ })).toBeDisabled();
    fireEvent.change(select, { target: { value: "s2" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Ana/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save partner" }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, call]) => call?.method === "PATCH")!;
    expect(url).toBe("/api/admin/laundry/suppliers/l2");
    expect(JSON.parse(String(init!.body))).toMatchObject({ name: "Bubbles", stockSupplierId: "s2", teamUserIds: ["u2"], reliabilityScore: 4 });
  });

  it("shows a load failure with Retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 })));
    render(<EstateSuppliers />);
    expect(await screen.findByRole("alert")).toHaveTextContent("FORBIDDEN");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
