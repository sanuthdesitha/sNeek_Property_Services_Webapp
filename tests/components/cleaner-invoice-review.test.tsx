/**
 * Money step (e): the read-only review page (lines from the snapshot, Approve
 * shown to administrators only, PDF link) and the list's row actions.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));
import { CleanerInvoiceReviewPage } from "@/components/v2/admin/cleaner-invoices/review/cleaner-invoice-review-page";
import { CleanerRowActions } from "@/components/v2/admin/cleaner-invoices/cleaner-invoice-columns";
import { cleanerInvoiceStages, type CleanerInvoiceReview } from "@/lib/cleaner/invoice-review";

const row = (status = "SUBMITTED", extra = {}) => ({
  id: "inv", invoiceNumber: "CL-0041", cleanerId: "c", cleanerName: "Sam", cleanerRole: "CLEANER", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-10-15T00:00:00Z",
  createdAt: "2026-10-16T00:00:00Z", hours: 2, totalAmount: 12, jobCount: 1, status, xeroBillId: null, xeroExportedAt: null,
  lineData: { lines: [{ description: "Shopping evidence", unitAmount: 6, quantity: 2 }] },
  paidAt: null, paidAmount: null, paidBankAccount: null, paidNote: null, paymentMethod: null, paidDate: null,
  paidClaimedAt: null, paidClaimedNote: null, paidClaimedProofUrls: [], changesRequestedAt: null, changesRequestedNote: null, ...extra,
}) as CleanerInvoiceReview["row"];
const review = (status = "SUBMITTED"): CleanerInvoiceReview => ({
  row: row(status),
  stages: cleanerInvoiceStages(row(status), null),
  history: [{ id: "h", at: "2026-10-16T00:00:00Z", label: "Submitted by the payee", actor: "Sam" }],
  comparison: { status: "not-applicable", reason: "Shown only while waiting." },
});
afterEach(cleanup);

it("shows the snapshotted lines, one h1, the stage bar, PDF and history", () => {
  render(<CleanerInvoiceReviewPage review={review()} role="ADMIN" backHref="/v2/admin/finance?tab=cleaner-invoices" />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByText("Shopping evidence")).toBeVisible();
  expect(screen.getAllByText("$12.00").length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "PDF" })).toHaveAttribute("href", "/api/admin/cleaner-invoices/inv/pdf?inline=1");
  expect(screen.getByText("Submitted by the payee")).toBeVisible();
  expect(screen.getByRole("button", { name: "Approve" })).toBeVisible();
});

it("hides Approve from an operations manager and says who can approve", () => {
  render(<CleanerInvoiceReviewPage review={review()} role="OPS_MANAGER" backHref="/v2/admin/finance?tab=cleaner-invoices" />);
  expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  expect(screen.getByText("Only an administrator can approve cleaner invoices.")).toBeVisible();
});

it("leads an approved invoice with Push to Xero in the list, and never offers Approve to an operations manager", () => {
  const onAction = vi.fn();
  render(<table><tbody><tr><td><CleanerRowActions row={row("APPROVED")} role="ADMIN" busy={false} disabled={false} reviewHref="/r" onAction={onAction} /></td></tr></tbody></table>);
  fireEvent.click(screen.getByRole("button", { name: "Push to Xero CL-0041" }));
  expect(onAction).toHaveBeenCalledWith("push-xero", expect.objectContaining({ id: "inv" }));
  cleanup();
  render(<table><tbody><tr><td><CleanerRowActions row={row("SUBMITTED")} role="OPS_MANAGER" busy={false} disabled={false} reviewHref="/r" onAction={onAction} /></td></tr></tbody></table>);
  expect(screen.getByRole("link", { name: "Review CL-0041" })).toHaveAttribute("href", "/r");
  fireEvent.click(screen.getByRole("button", { name: /More actions/ }));
  const menu = screen.getByRole("menu");
  expect(within(menu).queryByText("Approve")).toBeNull();
  expect(within(menu).getByText("Request changes")).toBeVisible();
});
