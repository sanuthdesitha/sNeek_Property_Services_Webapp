import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QaQueueWorkspace } from "@/components/v2/qa/qa-queue-workspace";

const fetcher = vi.fn();
const readyJob = (id: string) => ({ id, status: "SUBMITTED", inspectionReadiness: "READY", jobType: "AIRBNB_TURNOVER", property: { name: id } });
const assignment = (id: string, status = "ASSIGNED", job = readyJob(id)) => ({ id: `assignment-${id}`, jobId: id, status, job });
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });

beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => vi.unstubAllGlobals());

describe("QA readiness queue", () => {
  it("filters by readiness while preserving visit order and explains early inspection", async () => {
    fetcher.mockImplementation(async (url: string) => url.includes("/progress") ? response({}) : response({
      assignments: [
        assignment("Waiting house", "ASSIGNED", { ...readyJob("Waiting house"), status: "IN_PROGRESS", inspectionReadiness: "CLEANING" }),
        { ...assignment("Planned house"), scheduledFor: "2026-09-10T02:00:00Z" },
        assignment("Inspecting house", "IN_PROGRESS"),
        assignment("Ready house"),
      ], unassignedJobs: [],
    }));
    render(<QaQueueWorkspace inspectors={[]} canAssign={false} />);
    expect(await screen.findByText(/Waiting house —/)).toBeVisible();
    expect(screen.getByText(/Waiting for the cleaner's submission/)).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "Inspection readiness" }), { target: { value: "READY" } });
    expect(screen.getByText(/Ready house —/)).toBeVisible();
    expect(screen.queryByText(/Waiting house —/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planned house —/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Inspection readiness" }), { target: { value: "PLANNED" } });
    expect(screen.getByText(/Planned house —/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Start inspection" })).toHaveAttribute("href", "/v2/qa/jobs/Planned house");
    expect(screen.queryByRole("button", { name: /^Assign/ })).not.toBeInTheDocument();
  });

  it.each(["network", "http", "malformed"])("shows %s failure as unavailable, then recovers without false all-clear", async (failure) => {
    if (failure === "network") fetcher.mockRejectedValueOnce(new Error("offline"));
    else fetcher.mockResolvedValueOnce(response(failure === "http" ? { error: "offline" } : {}, failure !== "http"));
    fetcher.mockResolvedValue(response({ assignments: [], unassignedJobs: [] }));
    render(<QaQueueWorkspace inspectors={[]} canAssign={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("QA queue unavailable");
    expect(screen.queryByText("No jobs waiting")).not.toBeInTheDocument();
    expect(screen.queryByText("In queue", { selector: "p" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry queue" }));
    expect(await screen.findByText("No jobs waiting")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not replace the selected day's results with an older response", async () => {
    let resolveOld!: (value: unknown) => void;
    fetcher.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    fetcher.mockResolvedValue(response({ assignments: [assignment("Tomorrow house")], unassignedJobs: [] }));
    render(<QaQueueWorkspace inspectors={[]} canAssign={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(await screen.findByText(/Tomorrow house —/)).toBeVisible();
    await act(async () => resolveOld(response({ assignments: [assignment("Old house")], unassignedJobs: [] })));
    expect(screen.queryByText(/Old house —/)).not.toBeInTheDocument();
    expect(screen.getByText(/Tomorrow house —/)).toBeVisible();
  });

  it("opens completed reviews and suppresses execution on cancelled inspections", async () => {
    fetcher.mockResolvedValue(response({ assignments: [assignment("Reviewed house", "COMPLETED"), assignment("Cancelled house", "CANCELLED")], unassignedJobs: [] }));
    render(<QaQueueWorkspace inspectors={[]} canAssign={false} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "View review" })).toBeVisible());
    expect(screen.getByText(/This inspection was cancelled/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Start inspection" })).not.toBeInTheDocument();
  });
});
