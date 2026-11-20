/**
 * Bill to client on the Approvals pay request panel (2026-11-18): the panel
 * starts from the server's default, states what will be added to the client's
 * invoice, sends the client amount as its own figure, and a request that would
 * bill the client by default is never approved from the list without review.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { PayRequestPanel } from "@/components/v2/admin/approvals/panel/pay-panels";
import { toQueueRow, type ApprovalRecord } from "@/lib/admin/approvals/rows";
import { primaryActionFor } from "@/components/v2/admin/approvals/row-actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function record(clientBillingDefault: boolean): ApprovalRecord {
  return {
    id: "pa1",
    status: "PENDING",
    type: "FIXED",
    category: "SERVICE",
    requestedAmount: 40,
    cleanerRequestedAmount: 40,
    primaryDisplayAmount: 40,
    cleaner: { name: "Marco Rossi" },
    jobId: clientBillingDefault ? "j1" : null,
    job: clientBillingDefault ? { id: "j1", jobNumber: "J-1047", property: { name: "Glebe House" } } : undefined,
    property: { id: "p1", name: "Glebe House" },
    clientBillingDefault,
    requestedAt: new Date().toISOString(),
    attachmentUrls: [{ key: "k", url: "https://x/receipt.jpg" }],
  } as ApprovalRecord;
}

function renderPanel(clientBillingDefault: boolean) {
  const decide = vi.fn(async () => true);
  render(<PayRequestPanel row={toQueueRow("payAdjustments", record(clientBillingDefault))} busy={false} decide={decide} reload={async () => undefined} timezone="Australia/Sydney" />);
  return decide;
}

describe("bill to client on approval", () => {
  it("states the default and sends the client amount as its own figure", () => {
    const decide = renderPanel(true);
    const toggle = screen.getByLabelText("Bill this extra to the client") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText(/This will add \$40\.00 to the client's invoice for this job\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Client amount ($, before GST)"), { target: { value: "55" } });
    expect(screen.getByText(/This will add \$55\.00 to the client's invoice for this job\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Approve \$40\.00/ }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ body: { status: "APPROVED", approvedAmount: 40, billToClient: true, clientAmount: 55 } }));
  });

  it("switching the default off for one request says so and sends it", () => {
    const decide = renderPanel(true);
    fireEvent.click(screen.getByLabelText("Bill this extra to the client"));
    expect(screen.getByText(/you switched off the default/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Approve \$40\.00/ }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ body: { status: "APPROVED", approvedAmount: 40, billToClient: false } }));
  });

  it("an unlinked request is not billed by default and sends nothing about the client", () => {
    const decide = renderPanel(false);
    expect((screen.getByLabelText("Bill this extra to the client") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Approve \$40\.00/ }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ body: { status: "APPROVED", approvedAmount: 40 } }));
  });

  it("refuses a client amount of zero, keeping the draft", () => {
    const decide = renderPanel(true);
    fireEvent.change(screen.getByLabelText("Client amount ($, before GST)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Approve \$40\.00/ }));
    expect(decide).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Client amount ($, before GST)") as HTMLInputElement).value).toBe("0");
  });

  it("a request that bills the client by default is reviewed, never one-click approved from the list", () => {
    expect(primaryActionFor(toQueueRow("payAdjustments", record(true))).kind).toBe("review");
    expect(primaryActionFor(toQueueRow("payAdjustments", record(false))).kind).toBe("approve");
  });
});
