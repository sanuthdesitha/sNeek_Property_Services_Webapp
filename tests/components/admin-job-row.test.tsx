import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EJobRow, EBoardCard } from "@/components/v2/admin/jobs/job-row";
const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
const job = { id: "job-one", status: "PAUSED", property: { name: "QA Harbour Apartment", client: { name: "QA Client" } }, assignments: [], timingBadges: { early: "13:00", late: "10:30" } };
beforeEach(() => vi.clearAllMocks());
describe("admin job row", () => {
  it("keeps property and status in separate responsive grid cells", () => {
    render(<EJobRow job={job} selected={false} onToggleSelect={vi.fn()} onQuickAssign={vi.fn()} onManage={vi.fn()} />);
    expect(screen.getByText(job.property.name).closest(".e-job-row-property")).toBeTruthy();
    expect(screen.getByText("Paused").closest(".e-job-row-status")).toBeTruthy();
    expect(screen.getByRole("link")).toHaveClass("e-job-row");
    expect(screen.getByRole("button", { name: "Manage QA Harbour Apartment" })).not.toHaveClass("lg:opacity-0");
    expect(screen.getByText("EARLY 13:00")).toBeVisible();
    expect(screen.getByText("LATE 10:30")).toBeVisible();
  });
  it.each([EJobRow, EBoardCard])("does not navigate when keyboard-operating nested controls", Component => {
    const select = vi.fn();
    render(<Component job={job} selected={false} onToggleSelect={select} onQuickAssign={vi.fn()} onManage={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(select).toHaveBeenCalledWith(job.id);
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("link"), { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/v2/admin/jobs/job-one");
  });
});
