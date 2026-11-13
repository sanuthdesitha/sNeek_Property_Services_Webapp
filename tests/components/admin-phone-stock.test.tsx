/**
 * Stock on a phone (board "M-LaundryStock", 2026-11): Urgent needs with its
 * filters behind one Filter sheet, Report a need docked in thumb reach and
 * Reminder settings as the header gear; the need screen with Ask cleaner /
 * Add to run / the stage action at its foot and Confirm at property and
 * Resolve in "⋯"; the other tabs' tables stacked as cards. Nothing changes
 * from 640px up.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/v2/admin/inventory", useSearchParams: () => new URLSearchParams("tab=urgent-stock") }));
vi.mock("@/components/inventory/stay-preparation-panel", () => ({ StayPreparationPanel: () => null }));

import { UrgentNeedsWorkspace } from "@/components/v2/admin/inventory/urgent/urgent-needs-workspace";
import { NeedPanel } from "@/components/v2/admin/inventory/urgent/need-panel";
import { readUrgentView } from "@/components/v2/admin/inventory/urgent/urgent-view";
import { PhoneStackedTable } from "@/components/v2/admin/phone-stacked-table";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import type { UrgentNeedListRow } from "@/lib/inventory/urgent-stock-list";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

const NEED: UrgentNeedListRow = {
  id: "n1", propertyId: "p1", propertyName: "The Bondi Studio", itemId: "i1", itemName: "Toilet paper", unit: "roll", stage: "REPORTED", version: 1,
  observedCount: 0, observedAt: null, observationDisposition: "UNKNOWN", purchaseQuantity: 12, note: "Last guest used the spare pack.",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reportedById: "c", reportedByName: "Jane C.",
  parLevel: 12, suggestedBuy: 12, neededBy: null, neededByState: "unknown", sourceJob: null, shoppingRun: null, purchaseAsk: null,
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("reportId=")) return new Response(JSON.stringify({ items: [], events: [] }));
    return new Response(JSON.stringify({ rows: [NEED], total: 1, page: 1, pageSize: 25, counts: { open: 1 }, summary: { open: 1, properties: 1, dueSoon: 0 }, propertyOptions: [{ id: "p1", name: "The Bondi Studio" }], timeZone: "Australia/Sydney" }));
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function renderWorkspace() {
  return render(<UrgentNeedsWorkspace initialView={readUrgentView("")} tabs={null} timeZone="Australia/Sydney" canResolve canEditReminders />);
}

describe("Urgent needs on a phone", () => {
  it("puts stage, search and property behind one Filter sheet and docks Report a need", async () => {
    setPhone(true);
    stubFetch();
    renderWorkspace();
    await screen.findAllByText("Toilet paper");
    // The inline controls are not on the page; the Filter button opens them.
    expect(screen.queryByRole("searchbox", { name: "Search" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter urgent needs" });
    expect(within(sheet).getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(within(sheet).getByRole("group", { name: "Need stages" })).toBeTruthy();
    fireEvent.change(within(sheet).getByRole("searchbox", { name: "Search" }), { target: { value: "paper" } });
    fireEvent.click(within(sheet).getByRole("button", { name: /^Show 1 need/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove filter Search: paper" })).toBeTruthy());

    const bar = screen.getByRole("region", { name: "Urgent needs actions" });
    expect(within(bar).getByRole("button", { name: "Report a need" })).toBeTruthy();
    // One Report a need at any width: the header copy is not rendered on a phone.
    expect(screen.getAllByRole("button", { name: "Report a need" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reminder settings" })).toBeTruthy();
  });

  it("from 640px up keeps the inline filters and the header buttons, with no docked bar", async () => {
    setPhone(false);
    stubFetch();
    renderWorkspace();
    await screen.findAllByText("Toilet paper");
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Need stages" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Urgent needs actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report a need" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reminder settings" })).toBeTruthy();
  });
});

describe("the need screen", () => {
  it("docks Ask cleaner, Add to run and the stage action, with Confirm and Resolve in the menu", async () => {
    setPhone(true);
    stubFetch();
    const { container } = render(<NeedPanel needId="n1" row={NEED} timeZone="Australia/Sydney" canResolve onClose={vi.fn()} onChanged={vi.fn()} />);
    const actions = await waitFor(() => {
      const element = container.ownerDocument.querySelector<HTMLElement>("[data-need-phone-actions]");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(within(actions).getByRole("button", { name: "Ask cleaner to buy" })).toHaveTextContent("Ask cleaner");
    expect(within(actions).getByRole("button", { name: "Add to shopping run" })).toHaveTextContent("Add to run");
    expect(within(actions).getByRole("button", { name: "Acknowledge" })).toBeTruthy();
    expect(within(actions).getByText(/Nothing is bought until a shopping run or a cleaner does it/)).toBeTruthy();
    fireEvent.click(within(actions).getByRole("button", { name: "More actions for Toilet paper" }));
    expect(await screen.findByRole("menuitem", { name: "Confirm at property" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Resolve" })).toBeTruthy();
    // The desktop action row is not rendered as well.
    expect(screen.getAllByRole("button", { name: "Acknowledge" })).toHaveLength(1);
  });

  it("from 640px up keeps the panel's action row", async () => {
    setPhone(false);
    stubFetch();
    render(<NeedPanel needId="n1" row={NEED} timeZone="Australia/Sydney" canResolve onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Ask cleaner to buy" })).toHaveTextContent("Ask cleaner to buy");
    expect(screen.getByRole("button", { name: "Confirm at property" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy();
    expect(document.querySelector("[data-need-phone-actions]")).toBeNull();
  });
});

describe("the other Stock tabs' tables", () => {
  const table = (
    <ETableShell headers={[{ label: "Item" }, { label: "On hand" }]}>
      <tr><td>Toilet paper</td><td>4</td></tr>
    </ETableShell>
  );

  it("stack as cards on a phone, each cell labelled with its column", async () => {
    setPhone(true);
    const { container } = render(<PhoneStackedTable>{table}</PhoneStackedTable>);
    await waitFor(() => expect(container.querySelector("[data-phone-stacked-table]")).not.toBeNull());
    await waitFor(() => expect(screen.getByText("4").getAttribute("data-label")).toBe("On hand"));
    expect(screen.getByRole("columnheader", { name: "Item" })).toBeTruthy();
  });

  it("render exactly as before from 640px up", () => {
    setPhone(false);
    const { container } = render(<PhoneStackedTable>{table}</PhoneStackedTable>);
    const plain = render(table).container;
    expect(container.innerHTML).toBe(plain.innerHTML);
  });
});
