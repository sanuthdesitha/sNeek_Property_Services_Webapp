import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClientJobsBoard } from "@/components/v2/client/jobs-board";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const job = { id: "old-job", jobNumber: null, jobType: "DEEP_CLEAN", status: "COMPLETED", scheduledDate: "2001-01-01", startTime: null, dueTime: null, property: { id: "p1", name: "Harbour", suburb: "Sydney" }, assignments: [], jobTasks: [], laundryTask: null, satisfactionRating: null };
const props = { showCleanerNames: false, showClientTaskRequests: false, showLaundryUpdates: false };
beforeEach(() => localStorage.clear());
describe("client rebook links", () => {
  it.each([true, false])("shows a past completed rebook only when current booking permission is %s", (canBook) => {
    render(<ClientJobsBoard {...props} jobs={[job]} canBook={canBook} />);
    const show = screen.queryByRole("button", { name: "Show (1)" });
    if (show) fireEvent.click(show);
    if (canBook) expect(screen.getByRole("link", { name: "Rebook" })).toHaveAttribute("href", "/v2/client/booking?rebook=old-job");
    else expect(screen.queryByRole("link", { name: "Rebook" })).not.toBeInTheDocument();
  });
  it("does not offer unsupported past services for rebooking", () => {
    render(<ClientJobsBoard {...props} jobs={[{ ...job, jobType: "MAINTENANCE" }]} canBook />);
    const show = screen.queryByRole("button", { name: "Show (1)" });
    if (show) fireEvent.click(show);
    expect(screen.queryByRole("link", { name: "Rebook" })).not.toBeInTheDocument();
  });
});
