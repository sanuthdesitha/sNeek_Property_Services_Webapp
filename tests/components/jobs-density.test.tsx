import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EBoardCard } from "@/components/v2/admin/jobs/job-row";
import { JobsTable } from "@/components/v2/admin/jobs/jobs-table";
import { DEFAULT_JOBS_COLUMNS } from "@/lib/jobs/workspace-state";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const job = { id: "synthetic", property: { name: "Long property name with readable width", client: { name: "Client" } }, status: "COMPLETED", scheduledDate: "2026-09-09T00:00:00Z" };
const tableProps = { jobs: [job], columns: DEFAULT_JOBS_COLUMNS, sort: null, onSortChange: vi.fn(), selected: new Set<string>(), onSelectionChange: vi.fn(),
  activeJobId: null, onOpen: vi.fn(), onQuickAssign: vi.fn(), menuItems: () => [], loading: false, staleError: null, onRetry: vi.fn() };

describe("Jobs-only density", () => {
  it.each([
    ["compact", "py-1.5"], ["default", "py-2.5"], ["comfortable", "py-4"],
  ] as const)("pads %s table cells without changing the columns", (density, padding) => {
    render(<JobsTable {...tableProps} density={density} />);
    const cell = screen.getByRole("button", { name: `Preview ${job.property.name}` }).closest("td")!;
    expect(cell).toHaveClass(padding);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent?.trim())).toContain("Property");
  });
  it.each([
    ["compact", "p-2.5"], ["default", "p-3.5"], ["comfortable", "p-5"],
  ] as const)("renders %s board cards locally", (density, padding) => {
    const { container } = render(<EBoardCard job={job} density={density} selected={false} onToggleSelect={vi.fn()} onOpen={vi.fn()} onQuickAssign={vi.fn()} menuItems={[]} />);
    expect(container.querySelector("article")).toHaveClass(padding);
    expect(container.querySelector("[data-density]")).toBeNull();
  });
});
