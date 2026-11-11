import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EDataTable } from "@/components/v2/ui/data-table";
import { urgentColumns } from "@/components/v2/admin/inventory/urgent/urgent-columns";
import type { UrgentNeedListRow } from "@/lib/inventory/urgent-stock-list";
import { URGENT_STOCK_STAGES } from "@/lib/inventory/urgent-stock-policy";

afterEach(cleanup);

function row(stage: UrgentNeedListRow["stage"], index: number): UrgentNeedListRow {
  return {
    id: `n${index}`, propertyId: "p", propertyName: "Bondi", itemId: "i", itemName: `Item ${stage}`, unit: "roll", stage, version: 1,
    observedCount: index === 0 ? 0 : null, observedAt: null, observationDisposition: "UNKNOWN", purchaseQuantity: 12, note: "n",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reportedById: "c", reportedByName: "Jane C.",
    parLevel: null, suggestedBuy: null, neededBy: null, neededByState: stage === "PROPERTY_CONFIRMED" || stage === "ADMIN_RESOLVED" ? "closed" : "unknown",
  };
}

it("shows one next action per row from its stage, red when nothing is on hand, unknown counts as Unknown", () => {
  const act = vi.fn();
  const rows = URGENT_STOCK_STAGES.map(row);
  render(<EDataTable label="Urgent needs" columns={urgentColumns("Australia/Sydney", { open: vi.fn(), act })} rows={rows} rowKey={(r) => r.id} />);
  const table = screen.getByRole("table");
  const bodyRows = within(table).getAllByRole("row").slice(1);
  const actions = bodyRows.map((tr) => within(tr).queryAllByRole("button").map((button) => button.textContent).filter((text) => text && !text.startsWith("Item ")));
  expect(actions).toEqual([["Acknowledge"], ["Mark ordered"], ["Mark delivered"], [], [], []]);
  expect(within(bodyRows[3]).getByText("Waiting for cleaner to confirm")).toBeTruthy();
  expect(within(bodyRows[0]).getByText("0").className).toContain("danger");
  expect(within(bodyRows[1]).getByText("Unknown")).toBeTruthy();
  fireEvent.click(within(bodyRows[0]).getByRole("button", { name: "Acknowledge" }));
  expect(act).toHaveBeenCalledWith(rows[0]);
  expect(within(bodyRows[0]).getByText(/Reported by Jane C\./)).toBeTruthy();
});
