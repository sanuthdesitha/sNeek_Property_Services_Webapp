/**
 * Delivery review from the redesigned cleaner-invoice table (2026-11-11).
 * Rewritten for the paged list: the same rules as before (substantive evidence
 * required, closing keeps nothing, neither decision sends an email, a refused
 * or failed request keeps the evidence and the dialog). Changed on purpose:
 * after a decision the list is re-read from the server instead of patched
 * locally, and a transport failure says "Could not reach the server.".
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const m = vi.hoisted(() => ({ fetch: vi.fn(), toast: vi.fn(), push: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
import { CleanerInvoicesWorkspace } from "@/components/v2/admin/cleaner-invoices/cleaner-invoices-workspace";

const invoice = (id = "invoice", status = "SENDING") => ({
  id, invoiceNumber: `CL-${id}`, cleanerId: id, cleanerName: `Cleaner ${id}`, cleanerRole: "CLEANER", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-10-15T00:00:00Z",
  createdAt: "2026-10-03T00:00:00Z", hours: 2, totalAmount: 50, jobCount: 1, status, xeroBillId: null, xeroExportedAt: null,
  lineData: { delivery: "REVIEW_REQUIRED", lines: [{ description: "Shopping evidence", unitAmount: 6, quantity: 2 }] },
  paidAt: null, paidAmount: null, paidBankAccount: null, paidNote: null, paymentMethod: null, paidDate: null,
  paidClaimedAt: null, paidClaimedNote: null, paidClaimedProofUrls: [], changesRequestedAt: null, changesRequestedNote: null,
});
const page = (rows: unknown[]) => ({ rows, total: rows.length, page: 1, pageSize: 25, pageCount: 1, sort: "submitted", dir: "desc", counts: { all: rows.length, needsAction: rows.length, byStatus: {} } });
const ok = (body: unknown, status = true) => ({ ok: status, status: status ? 200 : 409, json: async () => body });
let listRows: unknown[];
let review: () => Promise<unknown>;
const evidence = "  Accounts verified the original receipt against the provider record.  ";
const textbox = () => screen.getByPlaceholderText("Reference the received invoice or provider evidence confirming it was not delivered.");
const reviewCalls = () => m.fetch.mock.calls.filter(([url]) => String(url).includes("delivery-review"));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", m.fetch);
  listRows = [invoice(), invoice("other", "SUBMITTED")];
  review = async () => ok({ ok: true, status: "SUBMITTED" });
  m.fetch.mockImplementation(async (url: string) => {
    if (url.includes("view=stats")) return ok({ awaitingAction: 2, awaitingValue: 100, inXero: 0, paid: 0 });
    if (url.includes("view=context")) return ok({ payees: [] });
    if (url.includes("delivery-review")) return review();
    return ok(page(listRows));
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open() {
  render(<CleanerInvoicesWorkspace role="ADMIN" />);
  fireEvent.click(await screen.findByRole("button", { name: /Review delivery CL-invoice/ }));
  return screen.getByRole("dialog");
}

it("requires substantive evidence; closing sends nothing and starts clean next time", async () => {
  const dialog = await open();
  expect(within(dialog).getByText(/Neither action sends an email/)).toBeVisible();
  const received = within(dialog).getByRole("button", { name: /Confirmed received/ });
  expect(received).toBeDisabled();
  fireEvent.change(textbox(), { target: { value: "   guess   " } });
  expect(received).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Review delivery CL-invoice/ }));
  expect(textbox()).toHaveValue("");
  expect(reviewCalls()).toHaveLength(0);
});

it.each([["CONFIRMED_SENT", /Confirmed received/], ["CONFIRMED_NOT_SENT", /Confirmed not delivered/]] as const)("records %s, sends no email and re-reads the list", async (resolution, label) => {
  const dialog = await open();
  fireEvent.change(textbox(), { target: { value: evidence } });
  listRows = [invoice("invoice", resolution === "CONFIRMED_SENT" ? "SUBMITTED" : "VOID"), invoice("other", "SUBMITTED")];
  fireEvent.click(within(dialog).getByRole("button", { name: label }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const [url, options] = reviewCalls()[0];
  expect(url).toBe("/api/admin/cleaner-invoices/invoice/delivery-review");
  expect(JSON.parse(options.body)).toEqual({ resolution, evidenceNote: evidence.trim() });
  expect(m.toast).toHaveBeenCalledWith({ title: "Delivery review recorded", description: "No email was sent or retried." });
  await waitFor(() => expect(screen.queryByRole("button", { name: /Review delivery CL-invoice/ })).toBeNull());
  expect(m.fetch.mock.calls.some(([u]) => String(u).includes("/invoice/send"))).toBe(false);
});

it("keeps the evidence and dialog after a server refusal", async () => {
  review = async () => ok({ error: "Delivery may still be in progress." }, false);
  const dialog = await open();
  fireEvent.change(textbox(), { target: { value: evidence } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Confirmed not delivered/ }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Review not saved", description: "Delivery may still be in progress.", variant: "destructive" })));
  expect(textbox()).toHaveValue(evidence);
  expect(within(dialog).getByRole("button", { name: /Confirmed not delivered/ })).toBeEnabled();
});

it("keeps the evidence after a transport failure", async () => {
  review = async () => { throw new Error("connection lost"); };
  const dialog = await open();
  fireEvent.change(textbox(), { target: { value: evidence } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Confirmed not delivered/ }));
  await waitFor(() => expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Review not saved", description: "Could not reach the server." })));
  expect(textbox()).toHaveValue(evidence);
});
