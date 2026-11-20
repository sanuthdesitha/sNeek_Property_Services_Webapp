/**
 * "Stock used" table (field type "inventory") on the cleaner form and in the
 * builder: a saved template with the seed's legacy question renders as a stock
 * table (not a text box, not an error); unanswered vs an explicit 0; refusals
 * in words; keyboard; the empty, untracked and failed-read states; the block
 * leaves out the items a table shows; the builder preview, settings and palette.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { DndContext } from "@dnd-kit/core";

vi.mock("next/navigation", () => ({ usePathname: () => "/v2/cleaner/jobs/j", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { CleanerPreview } from "@/components/v2/admin/forms/builder/cleaner-preview";
import { StockTableSettings } from "@/components/v2/admin/forms/builder/structured-type-settings";
import { OutlinePane } from "@/components/v2/admin/forms/builder/outline-pane";
import { checkTemplateSchema } from "@/lib/forms/template-checks";
import type { StockTableItem, StockTableStock } from "@/lib/forms/stock-table";
import type { FormField, FormSchema } from "@/lib/forms/types";

afterEach(cleanup);

const item = (itemId: string, name: string, area: StockTableItem["area"], onHand: number | null, sku: string | null = null, unit = "roll"): StockTableItem => ({
  itemId, name, sku, unit, location: area === "kitchen" ? "KITCHEN" : area === "bathroom" ? "BATHROOM" : "CLEANERS_CUPBOARD", area, onHand,
});
const STOCK: StockTableStock = {
  status: "ready",
  tracked: true,
  items: [
    item("tp", "Toilet paper", "bathroom", 12, "DEF-TP"),
    item("soap", "Hand soap", "bathroom", null, "DEF-HANDSOAP", "bottle"),
    item("caps", "Coffee capsules", "kitchen", 30, "DEF-COFFEECAPS", "capsule"),
  ],
};
const LEGACY_BATHROOM = { id: "s5_inventory", type: "inventory", label: "Bathroom supplies used", inventoryUsage: true, items: ["DEF-TP", "DEF-HANDSOAP"] } as unknown as FormField;

function Harness({ fields, stockTable, onRetry, property = {}, inventoryStock, initial = {} }: {
  fields: FormField[];
  stockTable?: StockTableStock;
  onRetry?: () => void;
  property?: Record<string, unknown>;
  inventoryStock?: Array<{ onHand: number; item: { id: string; name: string; unit?: string } }>;
  initial?: Record<string, unknown>;
}) {
  const [answers, setAnswers] = React.useState<Record<string, unknown>>(initial);
  return (
    <>
      <FormRenderer
        schema={{ sections: [{ id: "s", title: "Bathroom", fields }] }}
        answers={answers}
        uploads={{}}
        property={property}
        inventoryStock={inventoryStock}
        onAnswer={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
        onUpload={vi.fn()}
        stockTable={stockTable}
        onRetryStockTable={onRetry}
      />
      <output data-testid="answers">{JSON.stringify(answers)}</output>
    </>
  );
}
const answersNow = () => JSON.parse(screen.getByTestId("answers").textContent ?? "{}");

describe("cleaner form", () => {
  it("renders the seed's legacy question as a stock table, not a text box", () => {
    render(<Harness fields={[LEGACY_BATHROOM]} stockTable={STOCK} />);
    expect(screen.getByText("Bathroom supplies used")).toBeTruthy();
    expect(screen.getByLabelText("Toilet paper")).toBeTruthy();
    expect(screen.getByLabelText("Hand soap")).toBeTruthy();
    expect(screen.queryByLabelText("Coffee capsules")).toBeNull();
    expect(screen.getByText("Unit: roll · On hand: 12 roll")).toBeTruthy();
    expect(screen.getByText("Unit: bottle · On hand: not known")).toBeTruthy();
    expect(screen.getAllByText("Not answered yet")).toHaveLength(2);
  });

  it("keeps unanswered apart from an explicit 0 and writes the shared map", () => {
    render(<Harness fields={[LEGACY_BATHROOM]} stockTable={STOCK} />);
    fireEvent.click(screen.getByRole("button", { name: "None used: Hand soap" }));
    expect(answersNow().stockTableUsage).toEqual({ soap: 0 });
    expect(screen.getByText("None used")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "One more Toilet paper" }));
    fireEvent.click(screen.getByRole("button", { name: "One more Toilet paper" }));
    expect(answersNow().stockTableUsage).toEqual({ soap: 0, tp: 2 });
    fireEvent.change(screen.getByLabelText("Toilet paper"), { target: { value: "" } });
    expect(answersNow().stockTableUsage).toEqual({ soap: 0 });
    expect(answersNow().s5_inventory).toBeUndefined();
  });

  it("refuses a negative or part number in words and supports the arrow keys", () => {
    render(<Harness fields={[LEGACY_BATHROOM]} stockTable={STOCK} />);
    const tp = screen.getByLabelText("Toilet paper");
    fireEvent.change(tp, { target: { value: "-2" } });
    expect(screen.getByText("The amount used cannot be less than 0.")).toBeTruthy();
    fireEvent.change(tp, { target: { value: "1.5" } });
    expect(screen.getByText("The amount used must be a whole number of items.")).toBeTruthy();
    fireEvent.change(tp, { target: { value: "3" } });
    fireEvent.keyDown(tp, { key: "ArrowUp" });
    expect(answersNow().stockTableUsage.tp).toBe(4);
    fireEvent.keyDown(tp, { key: "ArrowDown" });
    fireEvent.keyDown(tp, { key: "ArrowDown" });
    expect(answersNow().stockTableUsage.tp).toBe(2);
  });

  it("shows one shared answer when two tables show the same item", () => {
    const all = { id: "all", type: "inventory", label: "All stock used", stockArea: "all" } as FormField;
    render(<Harness fields={[LEGACY_BATHROOM, all]} stockTable={STOCK} />);
    const inputs = screen.getAllByLabelText("Toilet paper") as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].id).not.toBe(inputs[1].id);
    fireEvent.change(inputs[1], { target: { value: "5" } });
    expect(inputs[0].value).toBe("5");
  });

  it("says when the area has no items, without blocking", () => {
    const laundry = { id: "l", type: "inventory", label: "Laundry used", stockArea: "laundry", required: true } as FormField;
    render(<Harness fields={[laundry]} stockTable={STOCK} />);
    expect(screen.getByText("No laundry items are set up for this property.")).toBeTruthy();
  });

  it("says when the property does not track stock", () => {
    render(<Harness fields={[LEGACY_BATHROOM]} stockTable={{ status: "ready", tracked: false, items: [] }} />);
    expect(screen.getByText("This property does not track stock, so there is nothing to record here.")).toBeTruthy();
  });

  it("shows a failed read with Try again, never as 'no items'", () => {
    const retry = vi.fn();
    render(<Harness fields={[LEGACY_BATHROOM]} stockTable={{ status: "unavailable", message: "The property's stock list could not be loaded." }} onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded");
    expect(screen.queryByText(/No .* items are set up/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("leaves the items a table shows out of the Stock & consumables block", () => {
    render(
      <Harness
        fields={[LEGACY_BATHROOM]}
        stockTable={STOCK}
        property={{ inventoryEnabled: true }}
        inventoryStock={[
          { onHand: 12, item: { id: "tp", name: "Toilet paper" } },
          { onHand: 30, item: { id: "caps", name: "Coffee capsules" } },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stock" }));
    const block = screen.getByText(/Stock & consumables used/).closest("section") as HTMLElement;
    expect(within(block).getByText("Coffee capsules")).toBeTruthy();
    expect(within(block).queryByText("Toilet paper")).toBeNull();
  });
});

describe("builder", () => {
  it("shows the legacy question in the live preview with example rows and no check error", () => {
    const schema: FormSchema = { sections: [{ id: "s5", title: "Bathroom", fields: [LEGACY_BATHROOM] }] };
    const checks = checkTemplateSchema(schema);
    expect(checks.issues.some((issue) => issue.rule === "unknown-field-type")).toBe(false);
    render(<CleanerPreview section={schema.sections[0]} theme={undefined} checks={checks} onShowChecks={vi.fn()} />);
    expect(screen.getByText("Bathroom supplies used")).toBeTruthy();
    expect(screen.getByText(/Example rows; the cleaner sees the property's own stock/)).toBeTruthy();
  });

  it("sets Show and the none-on-hand switch, and can drop a legacy item list", () => {
    const onUpdate = vi.fn();
    render(<StockTableSettings field={LEGACY_BATHROOM} onUpdate={onUpdate} />);
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "kitchen" } });
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ stockArea: "kitchen" });
    expect(screen.getByText(/limited to 2 listed items/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the Show setting only" }));
    expect(onUpdate.mock.calls[1][0].items).toBeUndefined();
    fireEvent.click(screen.getByRole("switch"));
    expect(onUpdate.mock.calls[2][0]).toMatchObject({ includeZeroOnHand: false });
  });

  it("offers Stock used in the palette with a short description", () => {
    const onAdd = vi.fn();
    render(
      <DndContext>
        <OutlinePane
          schema={{ sections: [{ id: "s", title: "Kitchen", fields: [] }] }}
          activeSectionId="s"
          onSelectSection={vi.fn()}
          onAddSection={vi.fn()}
          onAddQuestion={onAdd}
          onAddBlock={vi.fn()}
          onInsertBlock={vi.fn()}
          disabled={false}
        />
      </DndContext>,
    );
    const button = screen.getByRole("button", { name: /Stock used/ });
    expect(button.getAttribute("title")).toContain("how many of each item were used");
    fireEvent.click(button);
    expect(onAdd).toHaveBeenCalledWith("inventory");
  });
});
