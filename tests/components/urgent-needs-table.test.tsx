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
    sourceJob: null, shoppingRun: null, purchaseAsk: null,
  };
}

it("shows one next action per row from its stage, red when nothing is on hand, unknown counts as Unknown", () => {
  const act = vi.fn();
  const rows = URGENT_STOCK_STAGES.map(row);
  render(<EDataTable label="Urgent needs" columns={urgentColumns("Australia/Sydney", { open: vi.fn(), act, addToRun: vi.fn() })} rows={rows} rowKey={(r) => r.id} />);
  const table = screen.getByRole("table");
  const bodyRows = within(table).getAllByRole("row").slice(1);
  const actions = bodyRows.map((tr) => within(tr).queryAllByRole("button").map((button) => button.textContent).filter((text) => text && !text.startsWith("Item ")));
  // Wave F (as drawn): an acknowledged need not yet on a run offers "Add to shopping run".
  expect(actions).toEqual([["Acknowledge"], ["Add to shopping run"], ["Mark delivered"], [], [], []]);
  expect(within(bodyRows[3]).getByText("Waiting for cleaner to confirm")).toBeTruthy();
  expect(within(bodyRows[0]).getByText("0").className).toContain("danger");
  expect(within(bodyRows[1]).getByText("Unknown")).toBeTruthy();
  fireEvent.click(within(bodyRows[0]).getByRole("button", { name: "Acknowledge" }));
  expect(act).toHaveBeenCalledWith(rows[0]);
  expect(within(bodyRows[0]).getByText(/Reported by Jane C\./)).toBeTruthy();
});

it("Wave F: an acknowledged need already on a run offers Mark ordered and says which run; the reporter's job is linked", () => {
  const addToRun = vi.fn();
  const onRun: UrgentNeedListRow = { ...row("ACKNOWLEDGED", 1), shoppingRun: { id: "run", title: "Thursday shop", open: true, ownerName: "Ops", line: { plannedQty: 12, purchasedQty: 0, purchased: false } } };
  const fromJob: UrgentNeedListRow = { ...row("ACKNOWLEDGED", 2), sourceJob: { id: "job-1", jobNumber: "J-1038" } };
  const bought: UrgentNeedListRow = { ...row("ORDERED", 3), shoppingRun: { id: "run", title: "Thursday shop", open: false, ownerName: "Ops", line: { plannedQty: 12, purchasedQty: 12, purchased: true } } };
  render(<EDataTable label="Urgent needs" columns={urgentColumns("Australia/Sydney", { open: vi.fn(), act: vi.fn(), addToRun })} rows={[onRun, fromJob, bought]} rowKey={(r) => r.id} />);
  const bodyRows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  expect(within(bodyRows[0]).getByRole("button", { name: "Mark ordered" })).toBeTruthy();
  expect(within(bodyRows[0]).getByText('On run "Thursday shop"')).toBeTruthy();
  expect(within(bodyRows[1]).getByRole("link", { name: "J-1038" }).getAttribute("href")).toBe("/v2/admin/jobs/job-1");
  expect(within(bodyRows[1]).getByText(/Reported by Jane C\. during job/)).toBeTruthy();
  fireEvent.click(within(bodyRows[1]).getByRole("button", { name: "Add to shopping run" }));
  expect(addToRun).toHaveBeenCalledWith(fromJob);
  // Bought on the run is not delivered: the stage stays Ordered and the row says so.
  expect(within(bodyRows[2]).getByText(/Bought on run "Thursday shop" · 12 roll, not yet delivered/)).toBeTruthy();
  expect(within(bodyRows[2]).getByRole("button", { name: "Mark delivered" })).toBeTruthy();
});
