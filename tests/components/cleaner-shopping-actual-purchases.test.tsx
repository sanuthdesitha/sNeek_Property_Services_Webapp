import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShoppingRunWorkspace } from "@/components/v2/cleaner/shopping-run-workspace";
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
const run = { id: "run", name: "General shopping", ownerScope: "CLEANER", ownerName: "Cleaner", planningScope: "general", status: "IN_PROGRESS", rows: [], payment: { method: "COMPANY_CARD", paidByScope: "COMPANY", receipts: [] }, catalogItems: [{ id: "soap", name: "Hand soap", category: "Cleaning", unit: "bottle", supplier: "Shop" }] };
afterEach(() => vi.unstubAllGlobals());
function mount(data = run) {
  const fetcher = vi.fn(async (_url: any, init?: any) => new Response(JSON.stringify(init?.method === "PATCH" ? { ...data, ...JSON.parse(init.body) } : data)));
  vi.stubGlobal("fetch", fetcher);
  render(<ShoppingRunWorkspace apiBase="/api/cleaner/inventory/shopping-runs" runId="run" backHref="/v2/cleaner/shopping" backLabel="Shopping" title="Shopping run" />);
  return fetcher;
}
it("adds actual catalogue purchases to general stock without inventing planned quantities", async () => {
  const fetcher = mount(); await screen.findByText("Items actually bought");
  fireEvent.change(screen.getByLabelText("Catalogue item or custom purchase"), { target: { value: "soap" } });
  fireEvent.change(screen.getByLabelText("Purchased quantity"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Purchase unit cost"), { target: { value: "4.50" } });
  fireEvent.click(screen.getByRole("button", { name: "Add actual purchase" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body.rows).toEqual([expect.objectContaining({ propertyId: "", itemId: "soap", purchased: true, actualPurchasedQty: 3, actualUnitCost: 4.5, actualLineCost: 13.5, plannedQty: 0, estimatedLineCost: null })]);
});
it("records a custom purchase while retaining the original suggested row", async () => {
  const suggested = { propertyId: "property", propertyName: "House", suburb: "Sydney", itemId: "suggested", itemName: "Suggested item", category: "Cleaning", unit: "unit", plannedQty: 2, needed: 2, include: true, purchased: false, actualPurchasedQty: 0 };
  const fetcher = mount({ ...run, rows: [suggested] } as any); await screen.findByText("Items actually bought");
  fireEvent.change(screen.getByLabelText("Purchase name"), { target: { value: "Different brand" } });
  fireEvent.change(screen.getByLabelText("Purchase unit cost"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Add actual purchase" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body.rows[0]).toMatchObject(suggested);
  expect(body.rows[1]).toMatchObject({ isCustom: true, itemName: "Different brand", plannedQty: 0, purchased: true, actualPurchasedQty: 1 });
});
it("makes submitted purchases read-only", async () => {
  mount({ ...run, status: "COMPLETED", completedAt: "2026-09-22T00:00:00Z" } as any);
  await screen.findByText("Items actually bought");
  expect(screen.getByRole("button", { name: "Add actual purchase" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
});
