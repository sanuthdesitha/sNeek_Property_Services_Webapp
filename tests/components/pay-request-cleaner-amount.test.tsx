/**
 * Owner rule 2026-11-13: a cleaner pay request sent to the client at a
 * different amount still pays the cleaner what they REQUESTED. The Approvals
 * decision panel's pay field starts at the requested amount in every state —
 * never sent, client approved higher, client approved lower, counter-offer
 * open, counter-offer accepted — and after a reload (a fresh mount from the
 * list response). The client charge is shown beside it, read only, and never
 * copied into it. Above the request, the panel asks for the administrator
 * override and a reason before sending.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { PayRequestPanel } from "@/components/v2/admin/approvals/panel/pay-panels";
import { toQueueRow, type ApprovalRecord } from "@/lib/admin/approvals/rows";
import { primaryActionFor } from "@/components/v2/admin/approvals/row-actions";
import { normalizePayAdjustmentAmounts } from "@/lib/pay-adjustments/display";
import { toast } from "@/hooks/use-toast";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const REQUESTED = 40;

type ClientApprovalFixture = { status: string; amount: number; counterAmount?: number | null } | null;

/** What GET /api/admin/all-approvals sends for one pay request. */
function listRecord(clientApproval: ClientApprovalFixture): ApprovalRecord {
  const base = {
    id: "pa1",
    status: "PENDING",
    type: "FIXED",
    category: "SERVICE",
    requestedAmount: REQUESTED,
    cleanerId: "c1",
    cleaner: { name: "Marco Rossi" },
    jobId: "j1",
    job: { id: "j1", jobNumber: 1047, property: { name: "Glebe House" } },
    requestedAt: new Date().toISOString(),
    attachmentUrls: [{ key: "k", url: "https://x/receipt.jpg" }],
  };
  return {
    ...base,
    ...normalizePayAdjustmentAmounts(base, clientApproval as never),
    clientApproval: clientApproval ? { id: "ca1", currency: "AUD", ...clientApproval } : null,
  } as ApprovalRecord;
}

function renderPanel(clientApproval: ClientApprovalFixture, decide = vi.fn(async () => true)) {
  const row = toQueueRow("payAdjustments", listRecord(clientApproval));
  render(<PayRequestPanel row={row} busy={false} decide={decide} reload={async () => undefined} timezone="Australia/Sydney" />);
  return { row, decide };
}

const STATES: Array<[string, ClientApprovalFixture, RegExp | null]> = [
  ["never sent to the client", null, null],
  ["client approved a higher charge", { status: "APPROVED", amount: 60 }, /Client charge approved: \$60\.00/],
  ["client approved a lower charge", { status: "APPROVED", amount: 30 }, /Client charge approved: \$30\.00/],
  ["client counter-offer open", { status: "COUNTERED", amount: 60, counterAmount: 50 }, /Client counter-offer: \$50\.00/],
  ["counter-offer accepted", { status: "APPROVED", amount: 50, counterAmount: null }, /Client charge approved: \$50\.00/],
];

describe("pay request decision panel: the cleaner pay field", () => {
  it.each(STATES)("starts at the requested amount when %s", (_label, clientApproval, chargeLabel) => {
    renderPanel(clientApproval);
    const field = screen.getByLabelText("Pay the cleaner ($)") as HTMLInputElement;
    expect(field.value).toBe("40.00");
    if (chargeLabel) {
      // Shown beside the field, read only, and linked to it for screen readers.
      const charge = screen.getAllByText(chargeLabel);
      expect(charge.length).toBeGreaterThan(0);
      expect(field.getAttribute("aria-describedby")).toBeTruthy();
      expect(screen.queryAllByRole("spinbutton")).toHaveLength(1);
    } else {
      expect(screen.queryByText(/Client charge/)).toBeNull();
    }
  });

  it("starts at the requested amount again after a reload of the same request", () => {
    const first = renderPanel({ status: "APPROVED", amount: 60 });
    fireEvent.change(screen.getByLabelText("Pay the cleaner ($)"), { target: { value: "35" } });
    cleanup();
    // A reload re-reads the list and mounts a fresh panel from the response.
    renderPanel({ status: "APPROVED", amount: 60 }, first.decide);
    expect((screen.getByLabelText("Pay the cleaner ($)") as HTMLInputElement).value).toBe("40.00");
  });

  it("approves the requested amount, not the client charge", () => {
    const { decide } = renderPanel({ status: "APPROVED", amount: 60 });
    fireEvent.click(screen.getByRole("button", { name: /Approve \$40\.00/ }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ body: { status: "APPROVED", approvedAmount: 40 } }));
  });

  it("allows a lower amount without an override", () => {
    const { decide } = renderPanel({ status: "APPROVED", amount: 60 });
    fireEvent.change(screen.getByLabelText("Pay the cleaner ($)"), { target: { value: "35" } });
    expect(screen.queryByText(/Administrator override/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Approve \$35\.00/ }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ body: { status: "APPROVED", approvedAmount: 35 } }));
  });

  it("asks for the administrator override and a reason above the request, keeping the draft", () => {
    const { decide } = renderPanel({ status: "APPROVED", amount: 60 });
    fireEvent.change(screen.getByLabelText("Pay the cleaner ($)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve \$60\.00/ }));
    expect(decide).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "More than the cleaner requested" }));
    fireEvent.click(screen.getByLabelText(/Administrator override/));
    fireEvent.click(screen.getByRole("button", { name: /Approve \$60\.00/ }));
    expect(decide).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Reason for paying more/), { target: { value: "Extra hour agreed on site" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve \$60\.00/ }));
    expect(decide).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { status: "APPROVED", approvedAmount: 60, overrideAboveRequest: true, overrideReason: "Extra hour agreed on site" },
      }),
    );
    expect((screen.getByLabelText("Pay the cleaner ($)") as HTMLInputElement).value).toBe("60");
  });
});

describe("pay request list row", () => {
  it.each(STATES)("asks and one-click approves the requested amount when %s", (_label, clientApproval) => {
    const row = toQueueRow("payAdjustments", listRecord(clientApproval));
    expect(row.askedAmount).toBe(REQUESTED);
    expect(row.asked).toBe("$40.00");
    const action = primaryActionFor(row);
    if (action.kind === "approve") expect(action.body).toEqual({ status: "APPROVED", approvedAmount: REQUESTED });
  });

  it("shows no amount instead of $0.00 when the requested amount is missing", () => {
    const record = { ...listRecord(null), requestedAmount: null, cleanerRequestedAmount: null, primaryDisplayAmount: null };
    const row = toQueueRow("payAdjustments", record);
    expect(row.askedAmount).toBeNull();
    expect(row.asked).toBeNull();
    expect(primaryActionFor(row).kind).toBe("review");
  });
});
