/**
 * Amend this invoice (2026-11-23): the office's draft, its preview, the frozen
 * form while saving, the kept draft and request key after a failure, the stale
 * notice, and the refusal shown instead of the form (paid, ops after approval).
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { AmendInvoicePanel } from "@/components/v2/admin/cleaner-invoices/review/amend-invoice-panel";
import type { CleanerInvoiceRow } from "@/lib/cleaner/invoice-admin-list-types";

const row = (extra: Partial<CleanerInvoiceRow> = {}): CleanerInvoiceRow => ({
  id: "inv", invoiceNumber: "CL-1", cleanerId: "c", cleanerName: "Sam", cleanerRole: "CLEANER", periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-11-15T00:00:00Z",
  createdAt: "2026-11-16T00:00:00Z", hours: 4, totalAmount: 132, jobCount: 1, status: "SUBMITTED", xeroBillId: null, xeroExportedAt: null,
  lineData: { lines: [{ kind: "CLEANING", category: "LABOUR", description: "12 Nov · Bondi", quantity: 1, unitAmount: 120 }, { kind: "CLEANING", category: "REIMBURSEMENT", description: "Extra · parking", quantity: 1, unitAmount: 12 }] },
  paidAt: null, paidAmount: null, paidBankAccount: null, paidNote: null, paymentMethod: null, paidDate: null,
  paidClaimedAt: null, paidClaimedNote: null, paidClaimedProofUrls: [], changesRequestedAt: null, changesRequestedNote: null,
  amendmentCount: 0, amendedAt: null, xeroOutOfDateSince: null, updatedAt: "2026-11-16T01:00:00.000Z", ...extra,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("previews the changes, freezes while saving, and keeps the draft and the same request key after a failure", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const fetchMock = vi.fn(() => new Promise((done) => { resolve = done; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<AmendInvoicePanel row={row()} role="OPS_MANAGER" />);
  fireEvent.click(screen.getAllByRole("button", { name: "Remove this line" })[1]);
  fireEvent.change(screen.getAllByLabelText("Unit amount (AUD)")[0], { target: { value: "110" } });
  expect(screen.getByText("Removed “Extra · parking” (was $12.00)")).toBeVisible();
  expect(screen.getByText("Total $132.00 → $110.00")).toBeVisible();
  const save = screen.getByRole("button", { name: "Save amendment and tell the payee" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason (required; the payee is told)"), { target: { value: "Parking was personal." } });
  fireEvent.click(save);
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getAllByLabelText("Unit amount (AUD)")[0].closest("fieldset")).toBeDisabled();
  await act(async () => resolve({ ok: false, status: 409, json: async () => ({ error: "This invoice changed since you opened it." }) }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This invoice changed since you opened it.");
  expect(screen.getAllByLabelText("Unit amount (AUD)")[0]).toHaveValue(110);
  fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "Try again" }) }) as never);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save amendment and tell the payee" })); });
  const keys = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).requestKey);
  expect(keys[0]).toBe(keys[1]);
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  expect(body).toMatchObject({ expectedRevision: 0, expectedUpdatedAt: "2026-11-16T01:00:00.000Z", lines: [{ sourceIndex: 0, unitAmount: 110 }] });
});

it("shows the payee notice outcome after a save, never as delivered", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ revision: 1, beforeTotal: 132, afterTotal: 120, changes: ["Total $132.00 → $120.00"], needsXeroUpdate: false, notice: { status: "sent", outcomes: [{ transport: "INBOX", path: "pipeline", state: "inbox_available", errorCode: null }, { transport: "EMAIL", path: "direct", state: "provider_accepted", errorCode: null }] } }) })));
  render(<AmendInvoicePanel row={row()} role="ADMIN" />);
  fireEvent.click(screen.getAllByRole("button", { name: "Remove this line" })[1]);
  fireEvent.change(screen.getByLabelText("Reason (required; the payee is told)"), { target: { value: "Parking was personal." } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save amendment and tell the payee" })); });
  expect(await screen.findByText("Amendment 1 saved")).toBeVisible();
  expect(screen.getByText(/In-app notice: in their inbox · Email: accepted by the email provider \(not proof it was read\)/)).toBeVisible();
});

it("says why instead of offering the form: paid invoices go through a pay adjustment; approved money stays with an administrator", () => {
  render(<AmendInvoicePanel row={row({ status: "PAID", paidAt: "2026-11-20T00:00:00Z", paidAmount: 132 })} role="ADMIN" />);
  expect(screen.getByText(/Correct the money with a pay adjustment/)).toBeVisible();
  cleanup();
  render(<AmendInvoicePanel row={row({ status: "APPROVED" })} role="OPS_MANAGER" />);
  expect(screen.getByText(/only an administrator can amend/)).toBeVisible();
});

it("keeps a draft started on an older version and refuses to save it over the newer one", () => {
  const { rerender } = render(<AmendInvoicePanel row={row()} role="ADMIN" />);
  fireEvent.change(screen.getAllByLabelText("Unit amount (AUD)")[0], { target: { value: "100" } });
  rerender(<AmendInvoicePanel row={row({ updatedAt: "2026-11-17T00:00:00.000Z", amendmentCount: 1 })} role="ADMIN" />);
  expect(screen.getByText("This invoice changed since you started")).toBeVisible();
  expect(screen.getAllByLabelText("Unit amount (AUD)")[0]).toHaveValue(100);
  expect(screen.getByRole("button", { name: "Save amendment and tell the payee" })).toBeDisabled();
});
