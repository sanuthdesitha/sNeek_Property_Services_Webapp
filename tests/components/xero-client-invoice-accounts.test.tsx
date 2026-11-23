/**
 * Settings › Money › Xero › Client invoices (2026-11-23) and the invoice
 * editor's Xero card: warns when no sales account is chosen, offers to confirm
 * an already-stored 200 (kept working), saves only its own fields, refuses an
 * invalid code or a disbursement account equal to sales, never saves after a
 * failed read; the card lists each kind's account or the refusal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClientInvoiceAccountsCard } from "@/components/v2/admin/settings/xero-client-invoice-accounts";
import { XeroCard } from "@/components/v2/admin/finance/invoices/editor/editor-panels";
import { practiceInvoice } from "@/lib/tutorials/practice-samples";
import type { EditorXeroAccounts } from "@/lib/billing/client-invoice-editor-types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

function stubSettings(xero: Record<string, unknown>) {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    if (!init?.method) return json({ xero });
    const sent = JSON.parse(String(init.body)).xero;
    return json({ xero: { ...xero, ...sent, defaultAccountCodeConfirmed: sent.defaultAccountCodeConfirmed === true } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const patches = (fetchMock: ReturnType<typeof stubSettings>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init!.body)));

describe("Client invoices card", () => {
  it("warns when no sales account is stored and saves only its own fields, confirmed", async () => {
    const fetchMock = stubSettings({ defaultAccountCode: "", cleanerBillAccountCode: "477", defaultItemCode: "CLEAN" });
    render(<ClientInvoiceAccountsCard />);
    expect(await screen.findByText("No sales account chosen for client invoices")).toBeVisible();
    const sales = screen.getByLabelText("Sales account (required)");
    fireEvent.change(sales, { target: { value: "40 00" } });
    expect(screen.getByRole("button", { name: "Save client invoice accounts" })).toBeDisabled();
    fireEvent.change(sales, { target: { value: "4000" } });
    fireEvent.change(screen.getByLabelText("Shopping recharges account"), { target: { value: "4200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save client invoice accounts" }));
    expect(await screen.findByText("Client invoice accounts saved")).toBeVisible();
    expect(patches(fetchMock)).toEqual([
      {
        xero: {
          defaultAccountCode: "4000",
          clientRepairsAccountCode: "",
          clientShoppingAccountCode: "4200",
          clientCreditNoteAccountCode: "",
          disbursementAccountCode: "",
          defaultAccountCodeConfirmed: true,
        },
      },
    ]);
    expect(screen.queryByText("No sales account chosen for client invoices")).toBeNull();
  });

  it("shows an already-stored 200 as currently used and confirms it without changing it", async () => {
    const fetchMock = stubSettings({ defaultAccountCode: "200", defaultAccountCodeConfirmed: false, disbursementAccountCode: "820" });
    render(<ClientInvoiceAccountsCard />);
    expect(await screen.findByText("Currently used: 200 — confirm or change")).toBeVisible();
    expect(screen.getByLabelText("Sales account (required)")).toHaveValue("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm 200 as the sales account" }));
    expect(await screen.findByText("Client invoice accounts saved")).toBeVisible();
    expect(patches(fetchMock)[0].xero).toMatchObject({ defaultAccountCode: "200", disbursementAccountCode: "820", defaultAccountCodeConfirmed: true });
    expect(screen.queryByText("Currently used: 200 — confirm or change")).toBeNull();
    expect(screen.getByRole("button", { name: "Save client invoice accounts" })).toBeDisabled();
  });

  it("refuses a disbursement account equal to sales and keeps the draft after a server refusal", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => (init?.method ? json({ error: "A Xero account code uses letters, digits, dot, dash or underscore." }, 400) : json({ xero: { defaultAccountCode: "4000", defaultAccountCodeConfirmed: true } }))));
    render(<ClientInvoiceAccountsCard />);
    const disbursement = await screen.findByLabelText("Agency disbursements account");
    fireEvent.change(disbursement, { target: { value: "4000" } });
    expect(screen.getByText("Must differ from the sales account.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save client invoice accounts" })).toBeDisabled();
    fireEvent.change(disbursement, { target: { value: "820" } });
    fireEvent.click(screen.getByRole("button", { name: "Save client invoice accounts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A Xero account code uses letters");
    expect(disbursement).toHaveValue("820");
  });

  it("offers no save when the stored accounts could not be read", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "Database unavailable" }, 500)));
    render(<ClientInvoiceAccountsCard />);
    await waitFor(() => expect(screen.getByText("Could not read the client invoice accounts")).toBeVisible());
    expect(screen.queryByRole("button", { name: "Save client invoice accounts" })).toBeNull();
  });
});

describe("invoice editor Xero card", () => {
  function withAccounts(accounts: EditorXeroAccounts) {
    const data = practiceInvoice("Australia/Sydney");
    return { ...data, xero: { ...data.xero, accounts } };
  }

  it("says not chosen and why the push is refused, never 200", () => {
    render(<XeroCard data={withAccounts({ status: "not-set", reason: "Choose the Xero sales account…" })} />);
    expect(screen.getByText(/Not chosen\. Push to Xero, Update in Xero and the CSV export are refused/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Settings › Money › Xero" })).toHaveAttribute("href", "/v2/admin/settings?tab=xero");
    expect(screen.queryByText(/200/)).toBeNull();
  });

  it("lists each kind's account with its fallback, a missing disbursement account and the legacy confirmation", () => {
    render(
      <XeroCard
        data={withAccounts({
          status: "set",
          salesNeedsConfirmation: true,
          salesCode: "200",
          groups: [
            { label: "Cleaning services and other charges", code: "200", lines: 2, name: "Sales", nameReason: null, fallback: null, refusal: null },
            { label: "Repairs the client covers", code: "200", lines: 1, name: "Sales", nameReason: null, fallback: "No repairs account chosen, so the sales account", refusal: null },
            { label: "Shopping agency disbursements", code: null, lines: 1, name: null, nameReason: null, fallback: null, refusal: "Configure a separate balance-sheet disbursement account" },
          ],
        })}
      />,
    );
    expect(screen.getByText("No repairs account chosen, so the sales account")).toBeVisible();
    expect(screen.getByText("no account, so the push will be refused")).toBeVisible();
    expect(screen.getByText(/The sales account 200 was stored before accounts had to be chosen/)).toBeVisible();
  });

  it("says a reason shared by every unnamed account once", () => {
    render(
      <XeroCard
        data={withAccounts({
          status: "set",
          salesNeedsConfirmation: false,
          salesCode: "4000",
          groups: [
            { label: "Cleaning services and other charges", code: "4000", lines: 1, name: null, nameReason: "Xero is not connected.", fallback: null, refusal: null },
            { label: "Repairs the client covers", code: "4100", lines: 1, name: null, nameReason: "Xero is not connected.", fallback: null, refusal: null },
          ],
        })}
      />,
    );
    expect(screen.getAllByText(/Xero is not connected\./)).toHaveLength(1);
    expect(screen.getByText("Account names: Xero is not connected.")).toBeVisible();
  });
});
