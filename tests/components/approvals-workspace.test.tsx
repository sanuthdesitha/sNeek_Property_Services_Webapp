/**
 * Approvals redesign (board "Approvals", 2026-11): queue list with real
 * counts and folded empty queues, one primary action per row (Approve with a
 * receipt, Review without), the side panel with the queue's own decision,
 * and a bulk bar that offers only what the queue allows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/approvals/approvals-history", () => ({ ApprovalsHistory: () => <p>Decided list</p> }));

import { ApprovalsWorkspace } from "@/components/v2/admin/approvals/approvals-workspace";
import { sortByWaiting, toQueueRow, typeChips, waitingLabel } from "@/lib/admin/approvals/rows";
import { primaryActionFor } from "@/components/v2/admin/approvals/row-actions";

const QUEUES = [
  "continuations", "timingRequests", "payAdjustments", "timeAdjustments", "clientApprovals", "flaggedLaundry", "rescheduleRequests",
  "clientRequests", "qaReworkTransfers", "qaOutcomes", "skipRequests", "rectificationAdjustments", "bonusProposals", "falseConfirmations",
  "managementReviews", "cleanerInvoicePayClaims", "bookingRequests",
];
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();

const PAY_WITH_RECEIPT = {
  id: "pa1", status: "PENDING", type: "FIXED", category: "PARKING", requestedAmount: 42, cleanerId: "c1",
  cleaner: { name: "Marco Rossi" }, jobId: "j1", job: { id: "j1", jobNumber: 1047, property: { name: "Glebe House" } },
  requestedAt: twoDaysAgo, attachmentUrls: [{ key: "k", url: "https://x/receipt.jpg" }],
};
const PAY_NO_PROOF = {
  id: "pa2", status: "PENDING", type: "HOURLY", category: "SERVICE", requestedAmount: 22.67, requestedHours: 0.67, requestedRate: 34, cleanerId: "c2",
  cleaner: { name: "Aiko Tanaka" }, jobId: "j2", job: { id: "j2", jobNumber: 1058, property: { name: "Coogee Terrace" } },
  requestedAt: threeHoursAgo, attachmentUrls: [],
};
const TIMING = { id: "t1", status: "PENDING", requestType: "LATE_CHECKOUT", requestedTime: "11:00", jobId: "j3", job: { id: "j3", jobNumber: 1060, property: { name: "Manly Loft" } }, requestedAt: threeHoursAgo };

function payload() {
  return {
    ...Object.fromEntries(QUEUES.map((key) => [key, []])),
    payAdjustments: [PAY_NO_PROOF, PAY_WITH_RECEIPT],
    timingRequests: [TIMING],
    bookingAvailability: {},
    counts: { payAdjustments: 2, timingRequests: 1, total: 3 },
  };
}

let calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith("/api/admin/all-approvals")) return new Response(JSON.stringify(payload()));
      return new Response(JSON.stringify({ ok: true }));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Approvals list", () => {
  it("shows queues with real counts, folds empty ones and orders the queue oldest first", async () => {
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    const nav = await screen.findByRole("navigation", { name: "Queues" });
    await waitFor(() => expect(within(nav).getByRole("button", { name: /Pay requests\s*2/ })).toHaveAttribute("aria-pressed", "true"));
    expect(within(nav).getByRole("button", { name: /Empty queues\s*15/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/3 requests waiting on a decision · 1 older than 24 hours/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Pay requests" });
    const names = within(table).getAllByRole("button", { name: /^(Marco Rossi|Aiko Tanaka)$/ }).map((node) => node.textContent);
    expect(names).toEqual(["Marco Rossi", "Aiko Tanaka"]);
  });

  it("offers Approve for a request with a receipt and Review without, and opens the panel", async () => {
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    const table = await screen.findByRole("table", { name: "Pay requests" });
    await waitFor(() => expect(within(table).getAllByRole("row").length).toBeGreaterThan(2));
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Review" }));
    expect(window.location.search).toContain("open=pa2");
    const panel = await screen.findByRole("complementary", { name: "Request detail" });
    fireEvent.change(within(panel).getByLabelText("Admin note, optional"), { target: { value: "Thanks" } });
    fireEvent.click(within(panel).getByRole("button", { name: /Approve \$22\.67/ }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/admin/pay-adjustments/pa2")).toBe(true));
    const sent = calls.find((call) => call.url === "/api/admin/pay-adjustments/pa2");
    expect(JSON.parse(String(sent?.init?.body))).toEqual({ status: "APPROVED", approvedAmount: 22.67, decisionMessage: "Thanks" });
  });

  it("approves a timing request from the row with the panel's body", async () => {
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=timingRequests");
    render(<ApprovalsWorkspace />);
    const table = await screen.findByRole("table", { name: "Timing" });
    fireEvent.click(await within(table).findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/admin/job-early-checkouts/t1")).toBe(true));
    const sent = calls.find((call) => call.url === "/api/admin/job-early-checkouts/t1");
    expect(JSON.parse(String(sent?.init?.body))).toEqual({ status: "APPROVED" });
  });

  it("bulk bar: approve as asked shows count and total and sends each asked amount", async () => {
    // Changed on purpose (owner decision 2026-11-13): pay requests can be approved in bulk as asked.
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select Marco Rossi/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Aiko Tanaka/ }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "Approve as asked" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/Approve 2 pay requests, each at its own asked amount/);
    expect(dialog).toHaveTextContent(/no receipt/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve as asked" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/admin/approvals/bulk")).toBe(true));
    const sent = JSON.parse(String(calls.find((call) => call.url === "/api/admin/approvals/bulk")?.init?.body));
    expect(sent).toMatchObject({ queue: "payAdjustments", decision: "approve" });
    expect(Object.keys(sent.expectedAmounts).sort()).toEqual(["pa1", "pa2"]);
    expect(sent.expectedAmounts.pa2).toBe(22.67);
  });

  it("bulk bar: decline with one note is offered", async () => {
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=payAdjustments");
    render(<ApprovalsWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Select Marco Rossi/ }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "Decline with one note" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Decline with one note" }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/admin/approvals/bulk")).toBe(true));
    const sent = calls.find((call) => call.url === "/api/admin/approvals/bulk");
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({ queue: "payAdjustments", decision: "decline", ids: ["pa1"] });
  });
});

describe("approval rows", () => {
  it("builds table rows with type chips and waiting labels", () => {
    const rows = [toQueueRow("payAdjustments", PAY_WITH_RECEIPT), toQueueRow("payAdjustments", PAY_NO_PROOF)];
    expect(rows[0]).toMatchObject({ who: "Marco Rossi", jobLabel: "J-1047", asked: "$42.00", hasEvidence: true, typeDetail: "Receipt" });
    expect(typeChips(rows).map((chip) => [chip.label, chip.count])).toEqual([["Parking", 1], ["Extra time", 1]]);
    expect(sortByWaiting(rows, "newest").map((row) => row.id)).toEqual(["pa2", "pa1"]);
    expect(waitingLabel(2 * 86_400_000)).toBe("2 d");
    expect(primaryActionFor(rows[1])).toEqual({ kind: "review", label: "Review" });
    expect(primaryActionFor(toQueueRow("skipRequests", { id: "s1", cleanSkipAt: threeHoursAgo }))).toEqual({ kind: "review", label: "Review" });
  });
});
