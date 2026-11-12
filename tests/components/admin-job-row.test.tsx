import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EBoardCard } from "@/components/v2/admin/jobs/job-row";
import { jobRowMenuItems } from "@/components/v2/admin/jobs/job-row-menu";
import { JobsTable } from "@/components/v2/admin/jobs/jobs-table";
import { DEFAULT_JOBS_COLUMNS } from "@/lib/jobs/workspace-state";

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
const paused = { id: "job-one", status: "PAUSED", scheduledDate: "2026-09-09T00:00:00Z", property: { name: "QA Harbour Apartment", client: { name: "QA Client" } },
  assignments: [{ user: { name: "Cleaner One" } }], timingBadges: { early: "13:00", late: "10:30" } };
const unassigned = { ...paused, id: "job-two", status: "UNASSIGNED", assignments: [], property: { name: "Bondi Studio", client: { name: "QA Client" } } };
const handlers = { onPreview: vi.fn(), onChangeStatus: vi.fn(), onRemind: vi.fn() };
function table(jobs = [paused, unassigned], overrides: Record<string, unknown> = {}) {
  const props = { jobs, columns: DEFAULT_JOBS_COLUMNS, density: "default" as const, sort: null, onSortChange: vi.fn(), selected: new Set<string>(),
    onSelectionChange: vi.fn(), activeJobId: null, onOpen: vi.fn(), onQuickAssign: vi.fn(),
    menuItems: (job: typeof paused) => jobRowMenuItems(job, handlers, false), loading: false, staleError: null, onRetry: vi.fn(), ...overrides };
  render(<JobsTable {...props} />);
  return props;
}
beforeEach(() => vi.clearAllMocks());

describe("admin jobs table row", () => {
  it("keeps property and status in separate cells and shows timing flags", () => {
    table([paused]);
    const propertyCell = screen.getByRole("button", { name: "Preview QA Harbour Apartment" }).closest("td");
    const statusCell = screen.getByText("Paused").closest("td");
    expect(propertyCell).not.toBe(statusCell);
    expect(screen.getByText("EARLY 13:00")).toBeVisible();
    expect(screen.getByText("LATE 10:30")).toBeVisible();
  });

  it("offers one visible action per row: Assign only when nobody is on the job", () => {
    table();
    const rows = screen.getAllByRole("row").filter(row => within(row).queryByRole("checkbox", { name: /Select/ }) && !within(row).queryByRole("checkbox", { name: /page/ }));
    const pausedRow = rows.find(row => within(row).queryByText("QA Harbour Apartment"))!;
    const openRow = rows.find(row => within(row).queryByText("Bondi Studio"))!;
    expect(within(openRow).getByRole("button", { name: "Assign a cleaner to Bondi Studio" })).toBeVisible();
    expect(within(pausedRow).queryByRole("button", { name: /^Assign/ })).toBeNull();
    for (const row of [pausedRow, openRow]) {
      expect(within(row).queryByRole("button", { name: /^Manage/ })).toBeNull();
      expect(within(row).queryByRole("button", { name: "Open" })).toBeNull();
      expect(within(row).getByRole("button", { name: /More actions for/ })).toBeVisible();
    }
  });

  it("opens the peek panel from the row and the property name, never from nested controls", () => {
    const props = table();
    fireEvent.click(screen.getByText("Paused").closest("td")!);
    expect(props.onOpen).toHaveBeenCalledWith(paused);
    fireEvent.click(screen.getByRole("button", { name: "Preview Bondi Studio" }));
    expect(props.onOpen).toHaveBeenLastCalledWith(unassigned);
    props.onOpen.mockClear();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select QA Harbour/ }));
    fireEvent.click(screen.getByRole("button", { name: "Assign a cleaner to Bondi Studio" }));
    expect(props.onOpen).not.toHaveBeenCalled();
    expect(props.onQuickAssign).toHaveBeenCalledWith(unassigned);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps Manage (schedule tab) and Open full job in the menu", () => {
    const items = jobRowMenuItems(paused, handlers, false);
    expect(items.find(item => item.key === "manage")?.href).toBe("/v2/admin/jobs/job-one?tab=schedule");
    expect(items.find(item => item.key === "open")?.href).toBe("/v2/admin/jobs/job-one");
    expect(items.find(item => item.key === "remind")?.disabled).toBe(false);
    expect(jobRowMenuItems(unassigned, handlers, false).find(item => item.key === "remind")?.disabled).toBe(true);
    expect(jobRowMenuItems({ ...paused, status: "INVOICED" }, handlers, false).find(item => item.key === "status")?.disabled).toBe(true);
    expect(jobRowMenuItems(paused, handlers, true).find(item => item.key === "status")?.disabled).toBe(true);
  });

  it("board cards open the preview and keep the checkbox separate", () => {
    const onOpen = vi.fn(); const onToggleSelect = vi.fn();
    render(<EBoardCard job={paused} selected={false} onToggleSelect={onToggleSelect} onOpen={onOpen} onQuickAssign={vi.fn()} menuItems={[]} />);
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggleSelect).toHaveBeenCalledWith("job-one");
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview QA Harbour Apartment" }));
    expect(onOpen).toHaveBeenCalledWith(paused);
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
