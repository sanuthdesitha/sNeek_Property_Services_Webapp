/**
 * The three pay record pages (boards "Pay run", "Cleaner invoice", "Shopping
 * run", "Pay run and cleaner invoice, phone", 2026-11-17): one h1, stored
 * amounts only, missing figures in words, the confirmation tiers, the
 * collapsed breakdown with stored rate snapshots, role rules and the phone
 * layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, useSearchParams: () => new URLSearchParams(""), usePathname: () => "/v2/admin" }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

import { PayrollRunPage } from "@/components/v2/admin/finance/payroll-run/payroll-run-page";
import { CleanerInvoiceReviewPage } from "@/components/v2/admin/cleaner-invoices/review/cleaner-invoice-review-page";
import { ShoppingRunPage } from "@/components/v2/admin/inventory/shopping-run/shopping-run-page";
import { payoutProblems } from "@/lib/payroll/run-presentation";
import { cleanerInvoiceStages, type CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";
import type { PayrollRunView } from "@/lib/payroll/run-view";
import type { ShoppingRunPageData } from "@/lib/inventory/shopping-run-page";

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];
let answers: Record<string, unknown> = {};

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

beforeEach(() => {
  calls = [];
  answers = {};
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("/api/me/admin-pin")) return json({ hasPin: true, lockedUntil: null, userId: "admin", attemptsLeft: 5 });
    if (url.includes("/client-charges")) return json({ charges: [] });
    const key = Object.keys(answers).find((prefix) => url.startsWith(prefix));
    return key ? json(answers[key]) : json({});
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: phone && query.includes("max-width"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.matchMedia = (globalThis as unknown as { matchMedia: typeof window.matchMedia }).matchMedia;
}

/* ── Pay run ─────────────────────────────────────────────────────────── */

function payout(id: string, name: string, extra: Partial<PayrollRunView["payouts"][number]> = {}): PayrollRunView["payouts"][number] {
  const base = {
    id, cleanerId: `c-${id}`, cleanerName: name, cleanerEmail: `${id}@x.invalid`, amount: 1410, shoppingReimbursement: 0, transportAllowance: 24, adjustments: 0,
    status: "PENDING", method: "ABA_FILE", bankBsb: "062-000", bankAccountNumber: "12345412", bankAccountName: name, stripeAccountId: null, failureReason: null, jobCount: 21,
    ...extra,
  };
  return { ...base, problems: payoutProblems(base, { stripeConfigured: true }) };
}

function payRun(status = "CONFIRMED", payouts = [payout("p1", "Maria Santos"), payout("p2", "Liam O'Brien", { amount: 640, method: "MANUAL_BANK_TRANSFER", bankBsb: null, bankAccountNumber: null, transportAllowance: 0 })]): PayrollRunView {
  return {
    id: "run1", periodStart: "2026-10-31T14:00:00.000Z", periodEnd: "2026-11-14T13:59:59.000Z", periodStartDay: "2026-11-01", periodEndDay: "2026-11-14", status, totalPayable: 9860, totalShoppingReimbursements: 0, totalTransportAllowances: 24,
    totalAdjustments: -42, grandTotal: 2050, cleanerCount: payouts.length, createdAt: "2026-11-14T21:40:00.000Z", confirmedAt: status === "DRAFT" ? null : "2026-11-14T22:05:00.000Z", completedAt: null,
    notes: "Fortnight 1 – 14 Nov", createdByName: "Hannah Lee", abaGeneratedAt: null, abaGeneratedByName: null, stripeConfigured: true, timezone: "Australia/Sydney", payouts, history: [],
  };
}

describe("pay run page", () => {
  it("shows one h1, the stored totals, None in words and the problem flag before money moves", () => {
    render(<PayrollRunPage run={payRun()} role="ADMIN" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pay run, 1 – 14 Nov 2026");
    const table = screen.getByRole("region", { name: "Payouts table" });
    expect(within(table).getByText("$1,410.00")).toBeInTheDocument();
    expect(within(table).getAllByText("None").length).toBeGreaterThan(0);
    expect(within(table).getByText("No bank details")).toBeInTheDocument();
    expect(within(table).getByText("Cannot go in the ABA file")).toBeInTheDocument();
    expect(screen.getAllByText("$2,050.00").length).toBeGreaterThan(0);
  });

  it("keeps each person's jobs collapsed until opened, then shows stored rate snapshots and no per-job amount", async () => {
    answers["/api/admin/payroll/runs/run1/breakdown"] = { payoutId: "p1", jobs: [{ jobId: "j1", jobNumber: "J-1032", propertyName: "Paddington Terrace", day: "2026-11-02", rateSnapshot: 33, holidayMultiplier: null, assignmentRemoved: false }], shopping: [], adjustments: [{ id: "a1", label: "Rework deduction, J-1041", detail: null, amount: -42 }], inspections: [] };
    render(<PayrollRunPage run={payRun()} role="ADMIN" />);
    expect(calls.some((call) => call.url.includes("/breakdown"))).toBe(false);
    fireEvent.click(within(screen.getByRole("region", { name: "Payouts table" })).getByRole("button", { name: /^Maria Santos/ }));
    expect(await screen.findByText("$33.00/h")).toBeInTheDocument();
    expect(screen.getByText("Mon 2 Nov")).toBeInTheDocument();
    expect(screen.getByText("Rework deduction, J-1041").closest("li")).toHaveTextContent("−$42.00");
    expect(screen.getByText(/stores each person's totals, not an amount per job/)).toBeInTheDocument();
  });

  it("asks for the own PIN to process payouts and sends it with the request", async () => {
    answers["/api/admin/payroll/runs/run1/process"] = { successCount: 2, failCount: 0, status: "COMPLETED" };
    render(<PayrollRunPage run={payRun()} role="ADMIN" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Process payouts…" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Send payouts for 1 – 14 Nov 2026?");
    expect(dialog).toHaveTextContent("Liam O'Brien has no bank details; that payout stays Pending.");
    const pin = await within(dialog).findByLabelText("Your PIN");
    fireEvent.change(pin, { target: { value: "2468" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send payouts" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/admin/payroll/runs/run1/process")).toBe(true));
    const sent = calls.find((call) => call.url === "/api/admin/payroll/runs/run1/process");
    expect(JSON.parse(String(sent?.init?.body))).toEqual({ security: { pin: "2468" } });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it("marks one payout paid as tier A with the status it saw", async () => {
    render(<PayrollRunPage run={payRun()} role="OPS_MANAGER" />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Maria Santos's payout" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark paid…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Mark Maria's $1,410.00 as paid?");
    expect(within(dialog).queryByLabelText("Your PIN")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark paid" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.init?.method === "PATCH")?.init?.body))).toEqual({ payoutId: "p1", payoutStatus: "PAID", expectedPayoutStatus: "PENDING" });
  });

  it("greys Process for an operations manager with the reason, and keeps run status for administrators", () => {
    render(<PayrollRunPage run={payRun()} role="OPS_MANAGER" />);
    const process = screen.getAllByRole("button", { name: "Process payouts…" })[0];
    expect(process).toBeDisabled();
    expect(screen.getByText("Only an administrator can send payouts.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    expect(screen.getByRole("menuitem", { name: /Set status manually/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("offers Set back to Confirmed on a Failed run, with a reason and the PIN", async () => {
    const failed = payRun("FAILED", [payout("p3", "Priya Shah", { status: "FAILED", method: "STRIPE_CONNECT", stripeAccountId: "acct_1", bankBsb: null, bankAccountNumber: null, failureReason: "This account cannot receive payouts yet." })]);
    render(<PayrollRunPage run={failed} role="ADMIN" />);
    expect(screen.queryByRole("button", { name: "Process payouts…" })).toBeNull();
    expect(screen.getAllByText(/This account cannot receive payouts yet/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Set back to Confirmed…" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Change this run to Confirmed?");
    expect(within(dialog).getByRole("radio", { name: "Retry after failure" })).toBeInTheDocument();
    expect(await within(dialog).findByLabelText("Your PIN")).toBeInTheDocument();
  });

  it("phone: payouts as cards, needing attention first, and the docked next step", async () => {
    setPhone(true);
    render(<PayrollRunPage run={payRun()} role="ADMIN" />);
    const cards = screen.getByRole("list", { name: "Payouts" });
    expect(within(cards).getAllByRole("listitem")[0]).toHaveTextContent("Liam O'Brien");
    expect(await screen.findByRole("region", { name: "Pay run actions" })).toHaveTextContent("Process payouts…");
    setPhone(false);
  });
});

/* ── Cleaner invoice ─────────────────────────────────────────────────── */

const invoiceRow = (status = "SUBMITTED", extra = {}) => ({
  id: "inv", invoiceNumber: "CI-0142", cleanerId: "c", cleanerName: "Grace Kim", cleanerRole: "CLEANER", periodStart: "2026-10-31T13:00:00Z", periodEnd: "2026-11-14T12:59:00Z",
  createdAt: "2026-11-14T07:22:00Z", hours: 30.5, totalAmount: 1163.5, jobCount: 11, status, xeroBillId: null, xeroExportedAt: null, lineData: {},
  paidAt: null, paidAmount: null, paidBankAccount: null, paidNote: null, paymentMethod: null, paidDate: null,
  paidClaimedAt: null, paidClaimedNote: null, paidClaimedProofUrls: [], changesRequestedAt: null, changesRequestedNote: null, ...extra,
}) as CleanerInvoiceReview["row"];

function invoiceReview(status = "SUBMITTED", extra: Partial<CleanerInvoiceReview> = {}, rowExtra = {}): CleanerInvoiceReview {
  const row = invoiceRow(status, rowExtra);
  return {
    row,
    stages: cleanerInvoiceStages(row, null),
    history: [{ id: "h", at: "2026-11-14T07:22:00Z", label: "Submitted by the payee", actor: "Grace Kim" }],
    comparison: { status: "not-applicable", reason: "Shown only while waiting." },
    lines: [
      { index: 0, description: "1 Nov · Glebe House · Turnover", hours: null, rateSnapshot: 34, amount: 102, jobId: "j1", jobNumber: "J-1028" },
      { index: 1, description: "Money back · parking", hours: null, rateSnapshot: null, amount: 12.5, jobId: null, jobNumber: null },
    ],
    payRequests: [{ id: "a", title: "Oven deep clean", jobNumber: "J-1058", requestedAmount: 40, paidAmount: 40, decidedAt: null, decidedBy: "Hannah Lee", clientCharge: { kind: "APPROVED", amount: 60, label: "Client charge approved: $60.00" } }],
    xero: { state: "none", billId: null, exportedAt: null, lastFailure: null, connection: { status: "connected", tenantName: "sNeek", lastRefreshedAt: null } },
    paymentRecordedBy: null,
    timezone: "Australia/Sydney",
    ...extra,
  };
}

describe("cleaner invoice page", () => {
  it("states the pay rule from stored amounts with the client charge read only", () => {
    render(<CleanerInvoiceReviewPage review={invoiceReview()} role="ADMIN" backHref="/v2/admin/finance?tab=cleaner-invoices" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const band = screen.getByLabelText("Pay rule");
    expect(band).toHaveTextContent("Grace is paid what they asked for");
    expect(band).toHaveTextContent("Grace asked $40.00, paid $40.00.");
    expect(band).toHaveTextContent("Client charge approved: $60.00, read only");
    const lines = screen.getByRole("region", { name: "Invoice lines" });
    expect(within(lines).getByText("$34.00/h")).toBeInTheDocument();
    expect(within(lines).getAllByText("–").length).toBeGreaterThan(0);
    expect(within(lines).getByText("$1,163.50")).toBeInTheDocument();
  });

  it("asks before approving (tier A) and keeps the server rule for an operations manager", async () => {
    render(<CleanerInvoiceReviewPage review={invoiceReview()} role="ADMIN" backHref="/v2/admin/finance?tab=cleaner-invoices" />);
    fireEvent.click(screen.getAllByRole("button", { name: "Approve…" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Approve Grace's invoice for $1,163.50?");
    expect(dialog).toHaveTextContent("The pay request is paid at what was asked, $40.00.");
    expect(calls.some((call) => call.init?.method === "PATCH")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve invoice" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.init?.method === "PATCH")?.init?.body))).toEqual({ status: "APPROVED" });
    cleanup();
    render(<CleanerInvoiceReviewPage review={invoiceReview()} role="OPS_MANAGER" backHref="/v2/admin/finance?tab=cleaner-invoices" />);
    expect(screen.queryByRole("button", { name: "Approve…" })).toBeNull();
    expect(screen.getByText("Only an administrator can approve cleaner invoices.")).toBeVisible();
  });

  it("lists corrections apart: Reverse is tier B and Delete is tier C with the PIN", async () => {
    render(<CleanerInvoiceReviewPage review={invoiceReview()} role="ADMIN" backHref="/v2/admin/finance?tab=cleaner-invoices" />);
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Reverse…/ }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Removes something");
    expect(within(dialog).queryByLabelText("Your PIN")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getAllByRole("button", { name: "More" })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete…/ }));
    dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByLabelText("Your PIN")).toBeInTheDocument();
  });

  it("shows the Xero card states: not pushed, pushed, and a push that did not finish with its reason", () => {
    const { rerender } = render(<CleanerInvoiceReviewPage review={invoiceReview()} role="ADMIN" backHref="/b" />);
    expect(screen.getByText(/Not in Xero\./)).toBeInTheDocument();
    expect(screen.getByText(/Xero is connected \(sNeek\)/)).toBeInTheDocument();
    rerender(<CleanerInvoiceReviewPage review={invoiceReview("XERO_PUSHED", { xero: { state: "pushed", billId: "8f3a21c0abcdef", exportedAt: "2026-11-15T00:00:00Z", lastFailure: null, connection: { status: "not-connected" } } }, { xeroBillId: "8f3a21c0abcdef" })} role="ADMIN" backHref="/b" />);
    expect(screen.getByText(/draft bill 8f3a21c0…/)).toBeInTheDocument();
    expect(screen.getByText(/Xero is not connected/)).toBeInTheDocument();
    rerender(<CleanerInvoiceReviewPage review={invoiceReview("XERO_EXPORTING", { xero: { state: "pending", billId: null, exportedAt: null, lastFailure: { at: "2026-11-15T00:00:00Z", reason: "Xero said 503" }, connection: { status: "connected", tenantName: "sNeek", lastRefreshedAt: null } } })} role="ADMIN" backHref="/b" />);
    expect(screen.getByText(/Xero said 503/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry push" })[0]).toBeInTheDocument();
  });

  it("phone: opens on Lines with Compare and History one tap away, and docks the next step", async () => {
    setPhone(true);
    render(<CleanerInvoiceReviewPage review={invoiceReview()} role="ADMIN" backHref="/b" />);
    const sections = screen.getByRole("group", { name: "Invoice sections" });
    expect(within(sections).getByRole("button", { name: "Lines" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(sections).getByRole("button", { name: "Compare" }));
    expect(within(sections).getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("region", { name: "Invoice actions" })).toHaveTextContent("Approve…");
    setPhone(false);
  });
});

/* ── Shopping run ────────────────────────────────────────────────────── */

function shoppingData(receipts = 0, status: "PENDING_APPROVAL" | "READY" = "PENDING_APPROVAL"): ShoppingRunPageData {
  const rows = [
    { propertyId: "p1", propertyName: "Bondi Beach House", itemName: "Toilet paper", actualLineCost: 11.4, actualUnitCost: 0.95, actualPurchasedQty: 12, purchased: true },
    { propertyId: "p1", propertyName: "Bondi Beach House", itemName: "Hand wash refill", actualLineCost: null, actualUnitCost: null, actualPurchasedQty: 3, purchased: true },
    { propertyId: "p2", propertyName: "Coogee Terrace", itemName: "Paper towel", actualLineCost: null, actualUnitCost: null, actualPurchasedQty: 0, purchased: false },
  ].map((row) => ({ ...row, suburb: "", itemId: row.itemName, category: "c", supplier: null, unit: "roll", onHand: 0, parLevel: 0, reorderThreshold: 0, needed: 3, plannedQty: 3, include: true }));
  const run = {
    id: "run1", name: "Weekly top-up, Bondi and Coogee", status: "COMPLETED", ownerScope: "CLEANER", ownerUserId: "tom", clientId: null, planningScope: "all", rows,
    payment: { method: "CLEANER_PERSONAL_CARD", paidByScope: "CLEANER", paidByName: "Tom Nguyen", receipts: Array.from({ length: receipts }, (_, index) => ({ key: `k${index}`, url: `https://x.invalid/${index}`, name: `Coles ${index}` })) },
    shoppingTime: { requestedMinutes: 0, status: "NOT_REQUESTED", approvedMinutes: 0, approvedAmount: 0 },
    totals: { lineCount: 3, includedLineCount: 3, purchasedLineCount: 2, totalNeededUnits: 9, plannedUnits: 9, actualPurchasedUnits: 15, estimatedTotalCost: 20, actualTotalCost: 11.4, reimbursableClientAmount: 11.4, reimbursableCleanerAmount: 11.4, byProperty: [], bySupplier: [] },
    clientChargeStatus: "READY", cleanerReimbursementStatus: status, settlement: {}, ownerName: "Tom Nguyen", ownerEmail: "tom@x.invalid", paidByDisplay: "Tom Nguyen",
    clientAllocations: [{ clientId: "c1", clientName: "Harbour View Stays", clientEmail: null, propertyIds: ["p1", "p2"], propertyNames: ["Bondi Beach House", "Coogee Terrace"], lineCount: 3, actualAmount: 11.4, estimatedAmount: 20, receiptCount: receipts, requiresClientCharge: true }],
    dates: { createdAt: "2026-11-12T05:48:00Z", startedAt: "2026-11-12T23:20:00Z", submittedAt: "2026-11-13T02:05:00Z", approvedAt: null, closedAt: null },
    createdAt: "2026-11-12T05:48:00Z", updatedAt: "2026-11-13T02:05:00Z",
  } as unknown as ShoppingRunPageData["run"];
  return {
    run,
    lines: rows.map((row, index) => ({
      key: `k${index}`, propertyId: row.propertyId, propertyName: row.propertyName, clientName: "Harbour View Stays", itemName: row.itemName, unit: "roll", supplier: null, note: null,
      plannedQty: 3, include: true, purchased: row.purchased, boughtQty: row.actualPurchasedQty,
      cost: !row.purchased ? { state: "not-bought" as const } : row.actualLineCost === null ? { state: "missing" as const } : { state: "costed" as const, unitCost: 0.95, lineCost: 11.4 },
    })),
    coverage: { boughtLines: 2, costedLines: 1, missing: [{ propertyName: "Bondi Beach House", itemName: "Hand wash refill", quantity: 3 }] },
    approval: status === "READY" ? { at: "2026-11-15T22:40:00Z", by: "Hannah Lee", amount: 11.4, receiptOverrideNote: null } : null,
    history: [{ id: "submitted", at: "2026-11-13T02:05:00Z", label: "Submitted by Tom Nguyen" }],
    stockPosted: false,
    timezone: "Australia/Sydney",
  };
}

describe("shopping run page", () => {
  it("writes a missing cost as Not entered, never $0.00, and counts costed lines", () => {
    render(<ShoppingRunPage data={shoppingData(1)} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const table = screen.getByRole("region", { name: "Item lines" });
    expect(within(table).getAllByText("Not entered")).toHaveLength(2);
    expect(within(table).queryByText("$0.00")).toBeNull();
    expect(within(table).getByText("No cost entered")).toBeInTheDocument();
    expect(screen.getAllByText(/1 of 2 bought lines costed/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Reimbursement waiting")).toHaveTextContent("Hand wash refill ×3 for Bondi Beach House was bought but no cost was entered");
  });

  it("approves for the costed amount only, naming the missing line (tier A)", async () => {
    render(<ShoppingRunPage data={shoppingData(1)} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Approve reimbursement…" })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Approve $11.40 for Tom?");
    expect(dialog).toHaveTextContent("Hand wash refill ×3 for Bondi Beach House has no cost and is not included.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.init?.method === "PATCH")?.init?.body))).toEqual({ cleanerReimbursementStatus: "READY" });
  });

  it("needs a typed note to approve without a receipt and sends it for the audit", async () => {
    render(<ShoppingRunPage data={shoppingData(0)} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Approve reimbursement…" })[0]);
    const dialog = await screen.findByRole("dialog");
    const approve = within(dialog).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Receipt lost" } });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => expect(calls.some((call) => call.init?.method === "PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find((call) => call.init?.method === "PATCH")?.init?.body))).toEqual({ cleanerReimbursementStatus: "READY", approvalOverrideNote: "Receipt lost" });
  });

  it("confirms before adding bought items to stock (tier A) and says it adds nothing twice", async () => {
    answers["/api/admin/inventory/shopping-runs/run1/deposit-on-hand"] = { ok: true, count: 1, duplicated: false };
    render(<ShoppingRunPage data={shoppingData(1, "READY")} />);
    fireEvent.click(screen.getByRole("button", { name: "Add bought items to stock on hand…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Add 2 bought lines to stock on hand?");
    expect(dialog).toHaveTextContent("Running it again adds nothing twice.");
    expect(calls.some((call) => call.url.includes("deposit-on-hand"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to stock" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("deposit-on-hand") && call.init?.method === "POST")).toBe(true));
  });

  it("after approval leads with the purchase order and shows who approved", () => {
    render(<ShoppingRunPage data={shoppingData(1, "READY")} />);
    expect(screen.queryByRole("button", { name: "Approve reimbursement…" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Download purchase order" })[0]).toHaveAttribute("href", "/api/admin/inventory/shopping-runs/run1/po");
    expect(screen.getByLabelText("Reimbursement")).toHaveTextContent(/Approved by Hannah Lee/);
  });

  it("phone: Summary, Items and Receipts, with the approval docked", async () => {
    setPhone(true);
    render(<ShoppingRunPage data={shoppingData(1)} />);
    const sections = screen.getByRole("group", { name: "Run sections" });
    expect(within(sections).getByRole("button", { name: "Summary" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sections).getByRole("button", { name: "Items 3" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Shopping run actions" })).toHaveTextContent("Approve reimbursement…");
    setPhone(false);
  });
});
