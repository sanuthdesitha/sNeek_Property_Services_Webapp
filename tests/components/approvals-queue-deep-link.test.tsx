/**
 * Parity audit 2026-11-12: the Quality hub's "Mgmt review queue" card links to
 * /v2/admin/approvals?queue=managementReviews, which opens that queue instead
 * of the first queue with work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/approvals/approvals-history", () => ({ ApprovalsHistory: () => null }));

import { ApprovalsWorkspace } from "@/components/v2/admin/approvals/approvals-workspace";

const EMPTY_QUEUES = [
  "continuations", "timingRequests", "payAdjustments", "timeAdjustments", "clientApprovals", "flaggedLaundry", "rescheduleRequests",
  "clientRequests", "qaReworkTransfers", "qaOutcomes", "skipRequests", "rectificationAdjustments", "bonusProposals", "falseConfirmations",
  "managementReviews", "cleanerInvoicePayClaims", "bookingRequests",
];

function body() {
  return {
    ...Object.fromEntries(EMPTY_QUEUES.map((key) => [key, []])),
    bookingAvailability: {},
    counts: { continuations: 3, managementReviews: 0 },
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body()))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Approvals queue deep link", () => {
  it("opens the queue named in ?queue= even when another queue has work", async () => {
    window.history.replaceState(null, "", "/v2/admin/approvals?queue=managementReviews");
    render(<ApprovalsWorkspace />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /Management reviews/ })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: /Continuations/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("still lands on the first queue with work without a deep link", async () => {
    window.history.replaceState(null, "", "/v2/admin/approvals");
    render(<ApprovalsWorkspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Continuations/ })).toHaveAttribute("aria-pressed", "true"));
  });
});
