/**
 * Suppliers and Approvals on a phone (board "M-SuppliersApprovals", 2026-11):
 * supplier cards with an attention band, Open / "⋯" and Add supplier in thumb
 * reach, filters in one sheet; Approvals with the queue picker sheet, Select
 * mode and the docked bulk bar showing the asked total. Nothing changes from
 * 640px up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => search,
  usePathname: () => "/v2/admin/inventory",
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/approvals/approvals-history", () => ({ ApprovalsHistory: () => <p>Decided list</p> }));

import { SuppliersDirectory } from "@/components/v2/admin/inventory/suppliers/suppliers-directory";
import { ApprovalsWorkspace } from "@/components/v2/admin/approvals/approvals-workspace";

function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

const partner = {
  id: "l1", name: "CleanCo Laundry", phone: "02 9555 0140", email: "ops@cleanco.example", address: null, pricePerKg: 3.2, avgTurnaround: 48,
  reliabilityScore: null, notes: null, isActive: true, stockSupplierId: null, team: [], runCount: 7,
  stats: { toPickUp: 0, atLaundry: 3, toDrop: 0, late: 1, onTimePct: 92, measuredRuns: 12 },
};
const stock = { id: "s1", name: "Harbour Hygiene Supplies", email: "orders@harbour.example", phone: null, website: null, defaultLeadDays: 2, categories: ["Chemicals"], notes: null, isActive: true };
const directory = {
  rows: [
    { key: "laundry:l1", kind: "LAUNDRY", name: partner.name, stock: null, laundry: partner },
    { key: "s1", kind: "STOCK", name: stock.name, stock, laundry: null },
  ],
  trades: [],
  laundryUsers: [],
  danglingLinks: [],
};

const QUEUES = [
  "continuations", "timingRequests", "payAdjustments", "timeAdjustments", "clientApprovals", "flaggedLaundry", "rescheduleRequests",
  "clientRequests", "qaReworkTransfers", "qaOutcomes", "skipRequests", "rectificationAdjustments", "bonusProposals", "falseConfirmations",
  "managementReviews", "cleanerInvoicePayClaims", "bookingRequests",
];
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
const PAY_A = {
  id: "pa1", status: "PENDING", type: "FIXED", category: "PARKING", requestedAmount: 42, cleanerId: "c1",
  cleaner: { name: "Marco Rossi" }, jobId: "j1", job: { id: "j1", jobNumber: 1047, property: { name: "Glebe House" } },
  requestedAt: twoDaysAgo, attachmentUrls: [{ key: "k", url: "https://x/receipt.jpg" }],
};
const PAY_B = { ...PAY_A, id: "pa2", requestedAmount: 18.6, cleanerId: "c2", cleaner: { name: "Sam Okafor" }, jobId: "j2", job: { id: "j2", jobNumber: 1052, property: { name: "Manly Loft" } } };
const approvals = () => ({
  ...Object.fromEntries(QUEUES.map((key) => [key, []])),
  payAdjustments: [PAY_A, PAY_B],
  bookingAvailability: {},
  counts: { payAdjustments: 2, total: 2 },
});

let calls: Array<{ url: string; init?: RequestInit }> = [];
beforeEach(() => {
  calls = [];
  search = new URLSearchParams();
  replace.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("/api/admin/inventory/suppliers/directory")) return new Response(JSON.stringify(directory));
    if (url.startsWith("/api/admin/all-approvals")) return new Response(JSON.stringify(approvals()));
    return new Response(JSON.stringify({ ok: true }));
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Suppliers on a phone", () => {
  it("shows cards with Open and the same menu, a band for attention, and Add supplier in the action bar", async () => {
    setPhone(true);
    render(<SuppliersDirectory />);
    const list = await screen.findByRole("list", { name: "Suppliers" });
    expect(screen.queryByRole("table")).toBeNull();
    const cards = within(list).getAllByRole("listitem").filter((item) => item.parentElement === list);
    expect(cards).toHaveLength(2);
    const cleanco = cards.find((card) => card.textContent?.includes("CleanCo Laundry"))!;
    expect(cleanco.querySelector("[data-tone='attention']")).not.toBeNull();
    expect(cleanco).toHaveTextContent("1 late");
    fireEvent.click(within(cleanco).getByRole("button", { name: "More for CleanCo Laundry" }));
    const menu = screen.getByRole("menu", { name: "More for CleanCo Laundry" });
    expect(within(menu).getByRole("menuitem", { name: "Edit laundry partner" })).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.click(within(cleanco).getByRole("button", { name: "Open CleanCo Laundry" }));
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("open=laundry%3Al1"), { scroll: false });
    const bar = screen.getByRole("region", { name: "Suppliers actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "+ Add supplier" }));
    expect(within(screen.getByRole("menu", { name: "Add supplier" })).getByRole("menuitem", { name: "Stock supplier" })).toBeInTheDocument();
  });

  it("puts search and filters in one sheet and sorts from the card list", async () => {
    setPhone(true);
    render(<SuppliersDirectory />);
    await screen.findByRole("list", { name: "Suppliers" });
    expect(screen.queryByLabelText("Search suppliers")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter suppliers" });
    fireEvent.change(within(sheet).getByLabelText("Search suppliers"), { target: { value: "harbour" } });
    expect(within(sheet).getByLabelText("Category")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /Needs attention/ })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 1 supplier" }));
    expect(within(screen.getByRole("list", { name: "Active filters" })).getByRole("button", { name: "Remove filter Search: harbour" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sort by")).toHaveValue("name");
  });

  it("keeps the table and the header Add supplier from 640px up", async () => {
    setPhone(false);
    render(<SuppliersDirectory />);
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByLabelText("Search suppliers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add supplier ▾" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Suppliers actions" })).toBeNull();
  });
});

describe("Approvals on a phone", () => {
  it("opens queues from a sheet and selects a queue", async () => {
    setPhone(true);
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    const picker = await screen.findByRole("button", { name: /Queue: Pay requests/ });
    await waitFor(() => expect(picker).toHaveTextContent("2"));
    fireEvent.click(picker);
    const sheet = await screen.findByRole("dialog", { name: "Queues" });
    fireEvent.click(within(sheet).getByRole("button", { name: /All waiting/ }));
    await waitFor(() => expect(window.location.search).toContain("queue=all"));
    expect(screen.queryByRole("dialog", { name: "Queues" })).toBeNull();
  });

  it("Select mode feeds the docked bulk bar with the asked total; both bulk actions are reachable", async () => {
    setPhone(true);
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /^Select/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select Marco Rossi/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Sam Okafor/ }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(bar).toHaveTextContent("2 pay requests selected · $60.60 asked");
    expect(within(bar).getByRole("button", { name: "Decline with one note" })).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Approve as asked" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Approve 2 pay requests, each at its own asked amount: \$60\.60 in total/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve as asked" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/admin/approvals/bulk")).toBe(true));
    const sent = JSON.parse(String(calls.find((call) => call.url === "/api/admin/approvals/bulk")?.init?.body));
    expect(sent).toMatchObject({ queue: "payAdjustments", decision: "approve", expectedAmounts: { pa1: 42, pa2: 18.6 } });
  });

  it("from 640px up keeps the queue select and no total in the bulk bar", async () => {
    setPhone(false);
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select Marco Rossi/ }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).not.toHaveTextContent("$42.00 asked");
    expect(screen.getByLabelText("Queue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Queue: / })).toBeNull();
  });
});
