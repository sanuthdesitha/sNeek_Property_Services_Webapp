import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ShoppingClientCharges } from "@/components/v2/admin/inventory/shopping-client-charges";
const charge = { id: "charge", revision: 2, expenseAmount: 12, shoppingMinutes: 30, allocatedMinutes: 30, hourlyRate: null, labourAmount: 0, treatment: "PENDING", status: "DRAFT", invoiceId: null, reviewNote: null, property: { name: "House A" }, client: { name: "Client A" } };
const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockImplementation(() => response({ charges: [charge] })); });
it("requires treatment and independent client rate before approval, then sends revision and refreshes", async () => {
  render(<ShoppingClientCharges runId="run" />);
  const approve = await screen.findByRole("button", { name: "Approve for next invoice" }); expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Treatment for charge"), { target: { value: "RECHARGE" } }); expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Client rate for charge"), { target: { value: "40" } }); expect(approve).toBeEnabled();
  fetchMock.mockImplementation((_url, init) => init?.method === "PATCH" ? response({ ok: true }) : response({ charges: [{ ...charge, revision: 3, hourlyRate: 40, treatment: "RECHARGE", status: "APPROVED", labourAmount: 20 }] }));
  fireEvent.click(approve);
  await screen.findByText("Approved for the next invoice");
  const request = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH"); expect(JSON.parse(request![1].body)).toMatchObject({ id: "charge", expectedRevision: 2, hourlyRate: 40, shoppingMinutes: 30, status: "APPROVED" });
});
it("keeps rejected edits visible and never presents a failed approval as saved", async () => {
  render(<ShoppingClientCharges runId="run" />); await screen.findByLabelText("Client rate for charge");
  fireEvent.change(screen.getByLabelText("Client rate for charge"), { target: { value: "25" } });
  fetchMock.mockImplementation(() => response({ error: "Shopping billing changed. Refresh before reviewing." }, 409));
  fireEvent.click(screen.getByRole("button", { name: "Save pending review" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Shopping billing changed"); expect(screen.getByLabelText("Client rate for charge")).toHaveValue(25);
  expect(screen.queryByText("Approved for the next invoice")).not.toBeInTheDocument();
});
it("locks invoiced allocations and never automatically sends a mutation", async () => {
  fetchMock.mockImplementation(() => response({ charges: [{ ...charge, invoiceId: "invoice" }] })); render(<ShoppingClientCharges runId="run" />);
  await screen.findByText("Included in an invoice. This charge is locked."); expect(screen.queryByRole("button", { name: "Approve for next invoice" })).not.toBeInTheDocument(); expect(fetchMock.mock.calls.every(call => !call[1]?.method)).toBe(true);
});
it("shows server failures instead of successful empty allocation state", async () => { fetchMock.mockImplementation(() => response({ error: "Unavailable" }, 503)); render(<ShoppingClientCharges runId="run" />); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Unavailable")); expect(screen.queryByText(/No client allocations yet/)).not.toBeInTheDocument(); });
it("requires a note for waived cost and submits the waiver independently from labour", async () => {
  render(<ShoppingClientCharges runId="run" />);
  const approve = await screen.findByRole("button", { name: "Approve for next invoice" });
  fireEvent.change(screen.getByLabelText("Treatment for charge"), { target: { value: "RECHARGE" } });
  fireEvent.change(screen.getByLabelText("Client rate for charge"), { target: { value: "40" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Bill purchase cost to client" }));
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Review note/), { target: { value: "Purchase covered by office" } });
  expect(approve).toBeEnabled();
  fetchMock.mockImplementation((_url, init) => init?.method === "PATCH" ? response({ ok: true }) : response({ charges: [] }));
  fireEvent.click(approve);
  await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(true));
  const request = fetchMock.mock.calls.find(call => call[1]?.method === "PATCH");
  expect(JSON.parse(request![1].body)).toMatchObject({ expenseBillable: false, shoppingMinutes: 30, hourlyRate: 40, reviewNote: "Purchase covered by office" });
});
