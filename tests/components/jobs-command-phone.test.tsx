import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { JobsFilterBar } from "@/components/v2/admin/jobs/jobs-filter-bar";
import { WorkQueueRow } from "@/components/v2/admin/command/work-queue-row";
import { DEFAULT_JOBS_STATE, type JobsWorkspaceState } from "@/lib/jobs/workspace-state";
import type { JobsReferenceData } from "@/components/v2/admin/jobs/use-jobs-reference-data";
import type { WorkQueueItem } from "@/lib/dashboard/work-queue-types";

/** Command and Jobs on a phone (boards M-Command and M-Jobs, 2026-11). */
function setPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const reference: JobsReferenceData = {
  clients: [{ id: "c1", name: "Harbour View Stays" }],
  properties: [{ id: "p1", name: "The Bondi Studio", suburb: "Bondi Beach" }],
  cleaners: [{ id: "u1", name: "Jane Cleaner", email: "jane@example.com" }],
  inspectors: [],
  state: { clients: "ready", properties: "ready", cleaners: "ready", inspectors: "ready" },
} as JobsReferenceData;

function Harness({ initial }: { initial: Partial<JobsWorkspaceState> }) {
  const [state, setState] = useState<JobsWorkspaceState>({ ...DEFAULT_JOBS_STATE, ...initial });
  return <JobsFilterBar state={state} update={(patch) => setState((current) => ({ ...current, ...patch }))} reference={reference}
    optionsOpen={false} onToggleOptions={vi.fn()} resultLabel="Show 3 jobs" />;
}

describe("Jobs filters on a phone", () => {
  it("offer every desktop filter in the sheet and show active ones as removable chips", async () => {
    setPhone(true);
    render(<Harness initial={{ clientId: "c1", invoiced: "no" }} />);
    // Display tools stay visible beside the Filter button.
    expect(screen.getByRole("group", { name: "Layout" })).toBeInTheDocument();
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(within(chips).getAllByRole("button").map((button) => button.textContent)).toEqual(["Client: Harbour View Stays", "Not invoiced"]);
    fireEvent.click(screen.getByRole("button", { name: /^Filter · 2/ }));
    const sheet = await screen.findByRole("dialog", { name: "Filter jobs" });
    for (const label of ["Search jobs", "Filter by client", "Filter by property", "Filter by assigned cleaner", "Filter by job type", "Filter by invoice status", "Scheduled from date", "Scheduled to date"]) {
      expect(within(sheet).getByLabelText(label)).toBeInTheDocument();
    }
    fireEvent.click(within(sheet).getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });

  it("keep the inline row from 640px up", () => {
    setPhone(false);
    render(<Harness initial={{}} />);
    expect(screen.getByLabelText("Search jobs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Date" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
  });
});

describe("Command work queue rows on a phone", () => {
  const item = {
    id: "q1", category: "dispatch", urgency: "now", title: "Unassigned clean, tomorrow 10:00",
    detail: "The Bondi Studio · Airbnb turnover", href: "/v2/admin/jobs?open=j1",
    actions: [{ kind: "assign", label: "Assign", jobId: "j1", primary: true }],
  } as unknown as WorkQueueItem;

  it("become cards with a title band for decisions due now, keeping their actions", () => {
    const onAssign = vi.fn();
    render(<ul><WorkQueueRow item={item} status={{ pending: null, error: null }} onRequest={vi.fn()} onAssign={onAssign} onDocumentReminder={vi.fn()} /></ul>);
    const row = screen.getByRole("listitem");
    expect(row.className).toContain("max-sm:rounded-[12px]");
    expect(screen.getByText("Now").closest("span[class*='max-sm:col-start-2']")!.className).toContain("e-band-attention-bg");
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(onAssign).toHaveBeenCalledWith("j1");
  });
});
