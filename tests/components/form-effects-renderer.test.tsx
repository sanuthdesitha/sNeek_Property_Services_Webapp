// Wave B phone: Table rows as labelled cards, and question effects say what
// they do (live: the existing damage report opens prefilled; previews: "would").
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/cleaner/jobs/j", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/v2/cleaner/damage-report-form", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DamageReportForm: (props: { jobId: string; prefill?: { area?: string; category?: string } }) => (
    <div data-testid="damage-form">{`${props.jobId}|${props.prefill?.area}|${props.prefill?.category}`}</div>
  ),
}));
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { withPrefill } from "@/components/v2/cleaner/damage-report-form";

afterEach(cleanup);
const damage = { id: "dmg", type: "yesno" as const, label: "Anything damaged?", effects: [{ kind: "damage-report" as const, when: "yes" as const, category: "Breakage" }] };
const stock = { id: "tabs", type: "stock_count" as const, label: "Tablets left", stockItemId: "tabs", stockItemName: "Tablets", unit: "tablets", effects: [{ kind: "urgent-stock-below" as const, threshold: 3 }] };
const schema = { sections: [{ id: "k", title: "Kitchen", fields: [damage, stock] }] };

describe("question effects on the phone", () => {
  it("live: Yes prompts into the job's damage report with area and category prefilled", () => {
    render(<FormRenderer mode="live" effectsJobId="job-1" schema={schema} answers={{ dmg: true }} uploads={{}} property={{}} onAnswer={vi.fn()} onUpload={vi.fn()} />);
    expect(screen.getByText(/This answer needs a damage report/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the damage report" }));
    expect(screen.getByTestId("damage-form").textContent).toBe("job-1|Kitchen|Breakage");
  });
  it("sandbox: says what would happen and opens nothing", () => {
    render(<FormRenderer mode="sandbox" schema={schema} answers={{ dmg: true, tabs: { itemId: "tabs", count: 1 } }} uploads={{}} property={{}} onAnswer={vi.fn()} onUpload={vi.fn()} />);
    expect(screen.getByText(/Would open a damage report/)).toBeTruthy();
    expect(screen.getByText(/Would raise an urgent stock need/)).toBeTruthy();
    expect(screen.queryByTestId("damage-form")).toBeNull();
  });
  it("says nothing at or above the threshold", () => {
    render(<FormRenderer mode="live" schema={schema} answers={{ tabs: { itemId: "tabs", count: 3 } }} uploads={{}} property={{}} onAnswer={vi.fn()} onUpload={vi.fn()} />);
    expect(screen.queryByText(/urgent stock need/)).toBeNull();
  });
  it("prefills a new damage item only once", () => {
    const first = withPrefill([], { area: "Kitchen", category: "Breakage" });
    expect(first).toHaveLength(1);
    expect(withPrefill(first, { area: "kitchen ", category: "breakage" })).toHaveLength(1);
  });
});

describe("table on the phone", () => {
  it("renders one labelled card per fixed row and writes row objects", () => {
    const onAnswer = vi.fn();
    const table = { id: "t", type: "table" as const, label: "Appliances", table: { columns: [{ id: "c1", label: "Clean", cellType: "yesno" as const }], rowMode: "fixed" as const, rowLabels: ["Fridge", "Oven"] } };
    render(<FormRenderer mode="live" schema={{ sections: [{ id: "k", title: "Kitchen", fields: [table] }] }} answers={{}} uploads={{}} property={{}} onAnswer={onAnswer} onUpload={vi.fn()} />);
    expect(screen.getAllByRole("group").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Oven")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Yes" })[1]);
    expect(onAnswer).toHaveBeenCalledWith("t", [{}, { c1: true }]);
  });
});
