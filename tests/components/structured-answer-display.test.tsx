// Wave E: the office's submission views show a Table answer as a real table
// and a Stock count as "item · counted N unit"; the classic cleaner job page's
// field input renders and answers both types with the shared controls.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableAnswer, inlineAnswerText } from "@/components/v2/admin/forms/submissions/structured-answer";
import { FieldInput } from "@/components/forms/field-input";
import { legacyFormsPageRedirect } from "@/lib/admin/legacy-forms-redirects";
import type { FormField } from "@/lib/forms/types";

vi.mock("@/components/forms/form-theme", () => ({ useFormTheme: () => null }));

afterEach(cleanup);

const table = { columns: [{ id: "item", label: "Item", cellType: "text" }, { id: "count", label: "Count", cellType: "number" }, { id: "clean", label: "Clean", cellType: "yesno" }], rowMode: "fixed", rowLabels: ["Fridge", "Oven"] };
const tableField = { id: "appliances", type: "table", label: "Appliances", table } as unknown as FormField;
const stockField = { id: "paper", type: "stock_count", label: "Toilet paper left", unit: "rolls", stockItemId: "inv-1", stockItemName: "Toilet paper" } as unknown as FormField;

describe("office display", () => {
  it("renders a table answer as a table with column headers and row headers", () => {
    render(<TableAnswer field={tableField} value={[{ item: "Shelf", count: 3, clean: true }, { item: "Rack", count: 1, clean: false }]} />);
    const grid = screen.getByRole("table", { name: "Appliances" });
    expect(within(grid).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Row", "Item", "Count", "Clean"]);
    expect(within(grid).getByRole("rowheader", { name: "Fridge" })).toBeInTheDocument();
    expect(within(grid).getAllByRole("row")[1].textContent).toContain("Shelf3Yes");
  });

  it("shows an empty table answer as a dash, not an empty table", () => {
    render(<TableAnswer field={tableField} value={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("words a stock count as item · counted N unit", () => {
    expect(inlineAnswerText(stockField as never, { itemId: "inv-1", count: 6 })).toBe("Toilet paper · counted 6 rolls");
    expect(inlineAnswerText(stockField as never, null)).toBe("-");
  });
});

describe("classic cleaner field input", () => {
  it("renders a table question and answers it in the shared shape", () => {
    const onChange = vi.fn();
    render(<FieldInput field={tableField} value={undefined} onChange={onChange} />);
    expect(screen.getByText("Appliances")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Fridge: Count"), { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith([{ count: 4 }, {}]);
  });

  it("renders a stock count question with its item and unit", () => {
    const onChange = vi.fn();
    render(<FieldInput field={stockField} value={undefined} onChange={onChange} />);
    expect(screen.getByText(/Toilet paper · counted in rolls/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Toilet paper left"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith({ itemId: "inv-1", count: 7 });
  });
});

describe("classic forms page redirect map", () => {
  it.each([
    [undefined, "/v2/admin/forms?tab=forms"],
    [{ tab: "builder" }, "/v2/admin/forms?tab=forms"],
    [{ tab: "checklists" }, "/v2/admin/forms?tab=blocks&view=service"],
    [{ tab: "submissions", templateId: "t1" }, "/v2/admin/forms?tab=stats&view=submissions&templateId=t1"],
  ])("%j → %s", (searchParams, target) => {
    expect(legacyFormsPageRedirect(searchParams)).toBe(target);
  });
});
