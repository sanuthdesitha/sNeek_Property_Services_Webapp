/**
 * Settings › Money › Xero › Cleaner bills: reads the stored accounts, warns
 * when none is chosen, refuses an invalid code on screen, saves only its three
 * fields, keeps the draft after a refusal, and never saves after a failed read.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CleanerBillAccountsCard } from "@/components/v2/admin/settings/xero-cleaner-bill-accounts";

const stored = { xero: { defaultAccountCode: "200", cleanerBillAccountCode: "", cleanerBillInspectionAccountCode: "", cleanerBillReimbursementAccountCode: "" } };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

it("warns when no account is chosen, validates codes, and saves only the cleaner bill fields", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (!init?.method) return json(stored);
    return json({ xero: { ...stored.xero, ...JSON.parse(String(init.body)).xero } });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<CleanerBillAccountsCard />);
  expect(await screen.findByText("No account chosen for cleaner invoices")).toBeVisible();
  const work = screen.getByLabelText("Cleaning work account (required)");
  fireEvent.change(work, { target: { value: "4 77" } });
  expect(screen.getByRole("button", { name: "Save cleaner bill accounts" })).toBeDisabled();
  fireEvent.change(work, { target: { value: "477" } });
  fireEvent.change(screen.getByLabelText("Reimbursements account"), { target: { value: "620" } });
  fireEvent.click(screen.getByRole("button", { name: "Save cleaner bill accounts" }));
  expect(await screen.findByText("Cleaner bill accounts saved")).toBeVisible();
  const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(String(patch[1]!.body))).toEqual({ xero: { cleanerBillAccountCode: "477", cleanerBillInspectionAccountCode: "", cleanerBillReimbursementAccountCode: "620" } });
  expect(screen.queryByText("No account chosen for cleaner invoices")).toBeNull();
});

it("keeps the typed code after a refusal and shows the server's reason", async () => {
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => (init?.method ? json({ error: "A Xero account code uses letters, digits, dot, dash or underscore." }, 400) : json(stored))));
  render(<CleanerBillAccountsCard />);
  const work = await screen.findByLabelText("Cleaning work account (required)");
  fireEvent.change(work, { target: { value: "477" } });
  fireEvent.click(screen.getByRole("button", { name: "Save cleaner bill accounts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A Xero account code uses letters");
  expect(work).toHaveValue("477");
});

it("offers no save when the stored accounts could not be read", async () => {
  vi.stubGlobal("fetch", vi.fn(() => json({ error: "Database unavailable" }, 500)));
  render(<CleanerBillAccountsCard />);
  await waitFor(() => expect(screen.getByText("Could not read the cleaner bill accounts")).toBeVisible());
  expect(screen.queryByRole("button", { name: "Save cleaner bill accounts" })).toBeNull();
});
