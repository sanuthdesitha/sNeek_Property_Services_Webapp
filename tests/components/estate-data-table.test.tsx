import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EPagination, paginationRange } from "@/components/v2/ui/pagination";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EBulkBar } from "@/components/v2/ui/bulk-bar";

afterEach(cleanup);

type Row = { id: string; name: string; total: number };
const rows: Row[] = [
  { id: "a", name: "Alpha", total: 3 },
  { id: "b", name: "Bravo", total: 1 },
];
const columns: Array<EDataColumn<Row, "name" | "total">> = [
  { key: "name", header: "Name", sortKey: "name", cell: (row) => row.name },
  { key: "total", header: "Total", sortKey: "total", firstDir: "desc", cell: (row) => row.total },
  { key: "note", header: "Note", cell: () => "—" },
];

function Harness({ initial = { key: "name" as const, dir: "asc" as const } }) {
  const [sort, setSort] = React.useState<{ key: "name" | "total"; dir: "asc" | "desc" }>(initial);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const sorted = [...rows].sort((x, y) => (sort.dir === "asc" ? 1 : -1) * (x[sort.key] > y[sort.key] ? 1 : -1));
  return (
    <EDataTable
      label="Things"
      columns={columns}
      rows={sorted}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      selection={{ selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name}` }}
    />
  );
}

describe("EDataTable", () => {
  it("uses real header buttons with aria-sort, and keyboard activation reverses the order", () => {
    render(<Harness />);
    const nameHeader = screen.getByRole("columnheader", { name: /Name/ });
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("columnheader", { name: "Note" })).not.toHaveAttribute("aria-sort");
    const button = within(nameHeader).getByRole("button");
    button.focus();
    fireEvent.click(button); // Enter/Space on a native button fire click
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");
    const firstCell = () => screen.getAllByRole("row")[1].textContent;
    expect(firstCell()).toContain("Bravo");
    fireEvent.click(within(screen.getByRole("columnheader", { name: /Total/ })).getByRole("button"));
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("selects rows individually and all on the page, with an indeterminate header in between", () => {
    render(<Harness />);
    const all = screen.getByRole("checkbox", { name: "Select all on this page" }) as HTMLInputElement;
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Select Bravo" })).toBeChecked();
    expect(all).toBeChecked();
    fireEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Select Alpha" })).not.toBeChecked();
  });

  it("keeps loading, error, empty and stale apart", () => {
    const retry = vi.fn();
    const base = { label: "Things", columns, rowKey: (row: Row) => row.id };
    const { rerender } = render(<EDataTable {...base} rows={[]} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByText("Nothing to show")).toBeNull();
    rerender(<EDataTable {...base} rows={[]} error="Server said no" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Server said no");
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(retry).toHaveBeenCalled();
    rerender(<EDataTable {...base} rows={[]} emptyTitle="No invoices here" />);
    expect(screen.getByText("No invoices here")).toBeInTheDocument();
    rerender(<EDataTable {...base} rows={rows} error="Timed out" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing the last loaded list. Timed out");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("scrolls inside its own labelled region", () => {
    render(<EDataTable label="Things" columns={columns} rows={rows} rowKey={(row) => row.id} minWidth="60rem" />);
    const region = screen.getByRole("region", { name: "Things" });
    expect(region.className).toContain("overflow-x-auto");
    expect(within(region).getByRole("table")).toHaveStyle({ minWidth: "60rem" });
  });
});

describe("ERowMenu", () => {
  it("opens from the keyboard, moves with arrows, closes on Escape and returns focus", async () => {
    const onVoid = vi.fn();
    render(
      <ERowMenu
        label="More actions for INV-1"
        items={[
          { key: "a", label: "Approve", onSelect: vi.fn() },
          { key: "x", label: "Later", disabled: true, hint: "Coming in a later step" },
          { key: "v", label: "Void", danger: true, onSelect: onVoid, separated: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More actions for INV-1" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Approve" })).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    // The disabled item is skipped.
    expect(within(menu).getByRole("menuitem", { name: "Void" })).toHaveFocus();
    expect(within(menu).getByText("Coming in a later step")).toBeInTheDocument();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Void" }));
    expect(onVoid).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });
});

describe("EPagination, EFilterChips, EBulkBar", () => {
  it("states the real range and total", () => {
    expect(paginationRange(2, 25, 30)).toEqual({ from: 26, to: 30 });
    const onPage = vi.fn();
    render(<EPagination page={1} pageSize={25} total={143} onPageChange={onPage} />);
    expect(screen.getByText("Showing 1–25 of 143")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it("chips announce the pressed one and show counts only when known", () => {
    const onChange = vi.fn();
    render(<EFilterChips label="Status" active="a" onChange={onChange} chips={[{ key: "a", label: "Needs action", count: 9 }, { key: "b", label: "Paid", count: undefined }]} />);
    expect(screen.getByRole("button", { name: "Needs action 9" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Paid" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("bulk bar appears only with a selection", () => {
    const { rerender } = render(<EBulkBar count={0} noun={{ one: "draft", many: "drafts" }} onClear={vi.fn()}>x</EBulkBar>);
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
    rerender(<EBulkBar count={2} summary="$2,510.00" noun={{ one: "draft", many: "drafts" }} onClear={vi.fn()}>x</EBulkBar>);
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("2 drafts selected · $2,510.00");
  });
});
