import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EstateOnHand } from "@/components/v2/admin/inventory/estate-on-hand";
const auth = vi.hoisted(() => ({ impersonation: undefined as unknown }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ status: "authenticated", data: { user: { id: "admin" }, impersonation: auth.impersonation } }) }));
const fetcher = vi.fn();
const item = { id: "soap", name: "Laundry soap", unit: "bottles", category: "Cleaning" };
const row = (id: string, quantity: number) => ({ heldStockId: id, quantity, updatedAt: "2026-09-22T01:00:00.000Z", item, sourceNote: `Receipt ${id}` });
beforeEach(() => { sessionStorage.clear(); auth.impersonation = undefined; fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); fetcher.mockResolvedValue(new Response(JSON.stringify({ byHolder: [{ holder: { id: "cleaner", name: "Alex", email: "a@test", role: "CLEANER" }, items: [row("a", 2), row("b", 3)] }] }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("groups duplicate items while keeping individual original entries editable", async () => {
  render(<EstateOnHand />); await screen.findByText("5 bottles total"); expect(screen.getAllByText("Laundry soap")).toHaveLength(1); expect(screen.getByText("Cleaning")).toBeVisible();
  fireEvent.click(screen.getByText("2 entries · edit or deliver")); const edits = screen.getAllByRole("button", { name: "Set remaining quantity" }); expect(edits).toHaveLength(2);
  fireEvent.click(edits[1]); fireEvent.change(screen.getByLabelText("Remaining quantity"), { target: { value: "1" } }); fireEvent.change(screen.getByLabelText("Reason for adjustment"), { target: { value: "Count checked by office" } });
  fetcher.mockRejectedValueOnce(new Error("Connection lost")); fireEvent.click(screen.getByRole("button", { name: "Save remaining quantity" })); await screen.findByText("Retry same stock entry");
  const request = fetcher.mock.calls.find(call => call[1]?.method === "PATCH")!; expect(request[0]).toBe("/api/admin/inventory/held-stock"); expect(JSON.parse(request[1].body)).toMatchObject({ heldStockId: "b", quantity: 1, reason: "Count checked by office" });
});
it("keeps zero holdings correctable without counting them as holders with stock", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ byHolder: [{ holder: { id: "cleaner", name: "Alex", role: "CLEANER" }, items: [row("a", 0)] }] }))); render(<EstateOnHand />); await screen.findByText("0 bottles total"); fireEvent.click(screen.getByText("1 entry · edit or deliver")); expect(screen.getByRole("button", { name: "Set remaining quantity" })).toBeEnabled(); expect(screen.getByRole("button", { name: "Deliver", exact: true })).toBeDisabled();
});
it("disables mutation controls during impersonation", async () => { auth.impersonation = { actorId: "admin", mode: "FULL" }; render(<EstateOnHand />); await screen.findByText("5 bottles total"); fireEvent.click(screen.getByText("2 entries · edit or deliver")); expect(screen.getByRole("button", { name: "Record on-hand" })).toBeDisabled(); for (const button of screen.getAllByRole("button", { name: "Set remaining quantity" })) expect(button).toBeDisabled(); });
