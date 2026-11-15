/**
 * Everyday dialogs and sheets (board 2026-11): Record payment, Message team,
 * Report a stock need, Log a found item and New case on the shared form
 * layout. Each keeps its request, says what will happen, keeps a failed draft
 * (and its request key where the route has one), and is a phone sheet with
 * Cancel in the title bar and the primary docked.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordPaymentDialog } from "@/components/v2/admin/finance/invoices/payment-dialogs";
import { MessageTeamDialog } from "@/components/v2/admin/jobs/detail/message-team-dialog";
import { ReportNeedDialog } from "@/components/v2/admin/inventory/urgent/report-need-dialog";
import { LogItemDialog } from "@/components/v2/admin/lost-found/log-item-dialog";
import { CaseNewDialog } from "@/components/v2/admin/cases/case-new-dialog";
import type { InvoiceRow } from "@/components/v2/admin/finance/invoices/invoice-model";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/v2/admin/cases/case-link-pickers", () => ({ JobPicker: () => null, PropertyClientPickers: () => null }));

type Call = { url: string; method: string; body: Record<string, unknown> | null };
let calls: Call[];
let reply: (call: Call) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

beforeEach(() => {
  calls = [];
  reply = () => ({ status: 200, body: {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const { status, body } = await reply(call);
    return { ok: status < 400, status, json: async () => body };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const writes = () => calls.filter((call) => call.method !== "GET");

function expectPhoneSheet(dialog: HTMLElement, primary: RegExp) {
  expect(dialog.className).toContain("max-sm:rounded-t-[18px]");
  expect(within(dialog).getByText("Cancel", { selector: "span" }).className).toContain("sm:hidden");
  expect(within(dialog).getByRole("button", { name: "Cancel" }).className).toContain("max-sm:hidden");
  expect(within(dialog).getByRole("button", { name: primary }).parentElement?.className).toContain("max-sm:[&>*]:flex-1");
}

describe("Record a payment", () => {
  const invoice = { id: "inv1", invoiceNumber: "INV-2049", totalAmount: 3110, paidAmount: 1000, amountOwing: 2110, client: { id: "c1", name: "Harbour View Stays", email: "acc@harbour.test" } } as unknown as InvoiceRow;

  it("puts the money first, starts at what is owing and says it is not sent to Xero", () => {
    render(<RecordPaymentDialog invoice={invoice} onClose={vi.fn()} onDone={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /Record a payment/ });
    const money = within(dialog).getByRole("group", { name: "Invoice money" });
    expect(money).toHaveTextContent("Invoice total$3,110.00Already paid$1,000.00Still owing$2,110.00");
    expect(within(dialog).getByLabelText("Amount received")).toHaveValue(2110);
    expect(dialog).toHaveTextContent("It is not sent to Xero; payments only come in from Xero.");
    expect(dialog).toHaveTextContent("A receipt is emailed to acc@harbour.test, as before.");
    expectPhoneSheet(dialog, /Record \$2,110.00/);
  });

  it("sends the same body as before and keeps every field when the server refuses", async () => {
    reply = () => ({ status: 400, body: { error: "This invoice is a credit note." } });
    render(<RecordPaymentDialog invoice={invoice} onClose={vi.fn()} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Amount received"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Reference, optional"), { target: { value: "CBA 13/11" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Record $500.00" })); });
    expect(writes()[0]).toMatchObject({ url: "/api/admin/invoices/inv1", method: "PATCH", body: { recordPayment: { amount: 500, method: "BANK_TRANSFER", reference: "CBA 13/11" } } });
    expect(screen.getByRole("alert")).toHaveTextContent("Not recorded: This invoice is a credit note.");
    expect(screen.getByLabelText("Reference, optional")).toHaveValue("CBA 13/11");
  });
});

describe("Message the team", () => {
  const preview = {
    job: { id: "j1", label: "J-1063 · Glebe House" },
    recipients: [{ id: "u1", name: "Maria Lopez", hasPhone: true }, { id: "u2", name: "Tom Nguyen", hasPhone: false }],
    transports: { INBOX: { available: true, reason: null }, PUSH: { available: true, reason: null }, SMS: { available: true, reason: null } },
    saved: null,
    savedReadable: true,
    title: "Message from the office",
    bodyMax: 500,
  };

  it("retries a failed send with the SAME request key and keeps the text", async () => {
    let attempt = 0;
    reply = (call) => call.method === "GET" ? { status: 200, body: preview } : (attempt++ === 0 ? { status: 502, body: { error: "Gateway timeout" } } : { status: 200, body: { outcomes: [{ userId: "u1", name: "Maria Lopez", transport: "INBOX", state: "accepted", reason: null }], refused: [], replayed: false } });
    render(<MessageTeamDialog jobId="j1" onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog", { name: /Message the team/ });
    await waitFor(() => expect(within(dialog).getByText("J-1063 · Glebe House")).toBeVisible());
    fireEvent.change(within(dialog).getByLabelText(/^Message/), { target: { value: "Lockbox code changed." } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Send to 2" })); });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Gateway timeout");
    expect(within(dialog).getByLabelText(/^Message/)).toHaveValue("Lockbox code changed.");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Try again" })); });
    const [first, second] = writes();
    expect(first.body?.idempotencyKey).toBeTruthy();
    expect(second.body?.idempotencyKey).toBe(first.body?.idempotencyKey);
    expect(second.body).toMatchObject({ recipientIds: ["u1", "u2"], body: "Lockbox code changed.", transports: ["INBOX"] });
    expect(within(dialog).getByRole("group", { name: "After sending" })).toHaveTextContent("Maria Lopez");
  });
});

describe("Report a stock need", () => {
  it("keeps blank counts unknown, says it buys nothing and retries with the same request id", async () => {
    reply = (call) => call.method === "GET"
      ? { status: 200, body: { properties: [{ id: "p1", name: "Manly Loft" }], items: [{ itemId: "i1", item: { name: "Toilet paper", unit: "rolls" } }] } }
      : { status: 500, body: { error: "Database unavailable" } };
    render(<ReportNeedDialog open initialPropertyId="p1" onClose={vi.fn()} onReported={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /Report a stock need/ });
    expect(dialog).toHaveTextContent("Empty stays “unknown”, never 0.");
    expect(dialog).toHaveTextContent("it does not buy anything or prove delivery");
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Toilet paper (rolls)" })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "i1" } });
    fireEvent.change(within(dialog).getByLabelText("What and why"), { target: { value: "Last 2 rolls" } });
    expect(within(dialog).getByLabelText("Count seen")).toHaveAttribute("inputmode", "decimal");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Report need" })); });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Not reported: Database unavailable");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Report need" })); });
    const [first, second] = writes();
    expect(first.body).toMatchObject({ action: "report", propertyId: "p1", itemId: "i1", observedCount: null, purchaseQuantity: null, note: "Last 2 rolls" });
    expect(second.body?.requestId).toBe(first.body?.requestId);
    expectPhoneSheet(dialog, /Report need/);
  });
});

describe("Log a found item", () => {
  it("shows the guest the job will fill in BEFORE saving and sends the same body", async () => {
    reply = (call) => call.method === "GET"
      ? { status: 200, body: { properties: [{ id: "p1", name: "Bondi Beach House", suburb: null }], jobs: [{ id: "j1", jobNumber: "J-1051", scheduledDate: "2026-11-13T00:00:00.000Z", hasBooking: true, bookingGuest: "E. Novak", bookingCode: "HM123" }] } }
      : { status: 200, body: { itemId: "lf1" } };
    const onCreated = vi.fn();
    render(<LogItemDialog open timeZone="Australia/Sydney" onClose={vi.fn()} onCreated={onCreated} />);
    const dialog = screen.getByRole("dialog", { name: /Log a found item/ });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Bondi Beach House" })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText("Property"), { target: { value: "p1" } });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: /J-1051/ })).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText("Job, optional"), { target: { value: "j1" } });
    expect(within(dialog).getByRole("status")).toHaveTextContent("From J-1051: guest E. Novak (booking HM123). Saved with the item.");
    fireEvent.change(within(dialog).getByLabelText("Item"), { target: { value: "Watch, silver" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Log item" })); });
    expect(writes()[0]).toMatchObject({ url: "/api/admin/lost-found", body: { propertyId: "p1", jobId: "j1", itemName: "Watch, silver", location: null, notes: null, photos: [] } });
    expect(onCreated).toHaveBeenCalledWith("lf1");
  });

  it("Enter in a text box does not submit", async () => {
    reply = () => ({ status: 200, body: { properties: [], jobs: [] } });
    render(<LogItemDialog open timeZone="Australia/Sydney" onClose={vi.fn()} onCreated={vi.fn()} />);
    const item = screen.getByLabelText("Item");
    fireEvent.keyDown(item, { key: "Enter" });
    expect(writes()).toHaveLength(0);
  });
});

describe("New case", () => {
  it("offers type and priority as chips and client visibility as one three-way choice, mapped to the old fields", async () => {
    reply = () => ({ status: 200, body: { case: { id: "case1" } } });
    render(<CaseNewDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: /New case/ });
    expect(within(dialog).getByRole("radio", { name: "Hidden from client" })).toBeChecked();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Damage" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "High" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Client can see" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Scratched bench top" } });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Open case" })); });
    expect(writes()[0].body).toMatchObject({ title: "Scratched bench top", caseType: "DAMAGE", severity: "HIGH", clientVisible: true, clientCanReply: false });
  });

  it("Can see and reply sends both flags; Hidden keeps reply at its old default", () => {
    render(<CaseNewDialog open onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("radio", { name: "Can see and reply" }));
    expect(screen.getByRole("radio", { name: "Can see and reply" })).toBeChecked();
    expectPhoneSheet(screen.getByRole("dialog"), /Open case/);
  });
});
