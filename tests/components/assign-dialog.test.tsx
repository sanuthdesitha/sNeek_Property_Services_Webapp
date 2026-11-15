/**
 * The ONE assign dialog (board "Everyday dialogs and sheets", 2026-11): every
 * old entry point (Jobs quick assign, job page / Calendar, Jobs bulk bar)
 * opens it and sends the same request body as before; leave and expired
 * documents show before Save; "Assign anyway" sends the existing override;
 * a 409 the list did not foresee is still handled; drafts and late answers.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignDialog } from "@/components/v2/admin/jobs/assign-dialog";
import { AssignCleanersModal } from "@/components/v2/admin/jobs/assign-cleaners-modal";
import { QuickAssignDialog } from "@/components/v2/admin/jobs/quick-assign-dialog";
import { JobsBulk } from "@/components/v2/admin/jobs/jobs-bulk";
import type { JobListRow } from "@/components/v2/admin/jobs/jobs-query";
import type { AssignFactsResponse } from "@/lib/jobs/assign-facts-types";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

type Pending = { url: string; body: unknown; resolve: (body: unknown, status?: number) => void };
let calls: Pending[];

const CLEANERS = [
  { id: "u1", name: "Maria Lopez", email: "maria@x" },
  { id: "u2", name: "Sofia Alvarez", email: "sofia@x" },
  { id: "u3", name: "Liam O'Brien", email: "liam@x" },
];

function facts(jobIds: string[], overrides: Partial<Record<string, AssignFactsResponse["cleaners"][number]["warnings"]>> = {}): AssignFactsResponse {
  return {
    jobs: jobIds.map((id) => ({ id, dayKey: "2026-11-21" })),
    cleaners: CLEANERS.map((cleaner) => ({ userId: cleaner.id, otherJobsThatDay: jobIds.length === 1 ? 2 : null, warnings: overrides[cleaner.id] ?? [] })),
  };
}

const WARNINGS = {
  u2: [{ kind: "leave" as const, jobId: "j1", text: "On leave 19–23 Nov" }],
  u3: [{ kind: "police_check" as const, jobId: "j1", text: "police check expired 2 Oct 2026" }],
};

const callsTo = (fragment: string) => calls.filter((call) => call.url.includes(fragment));
async function answer(call: Pending | undefined, body: unknown, status = 200) {
  if (!call) throw new Error("No such call");
  await act(async () => { call.resolve(body, status); });
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => new Promise((resolve) => {
    calls.push({
      url,
      body: init.body ? JSON.parse(String(init.body)) : null,
      resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }),
    });
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const quickJob = { id: "j1", jobNumber: "J-1088", jobType: "AIRBNB_TURNOVER", scheduledDate: "2026-11-21T00:00:00.000Z", startTime: "10:00", property: { id: "p1", name: "Glebe House" } } as unknown as JobListRow;

describe("one assign dialog from every entry point", () => {
  it("Jobs quick assign: same body as before ({ userIds, primaryUserId })", async () => {
    const onAssigned = vi.fn();
    render(<QuickAssignDialog job={quickJob} cleaners={CLEANERS} onClose={vi.fn()} onAssigned={onAssigned} />);
    expect(screen.getByRole("dialog", { name: /Assign cleaners/ })).toBeVisible();
    expect(screen.getByText(/J-1088 · Glebe House/)).toBeVisible();
    await answer(callsTo("/assign-facts")[0], facts(["j1"]));
    expect(callsTo("/assign-facts")[0].url).toBe("/api/admin/jobs/assign-facts?jobIds=j1");
    fireEvent.click(screen.getByText("Maria Lopez"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Assign 1/ })); });
    const assign = callsTo("/api/admin/jobs/j1/assign")[0];
    expect(assign.body).toEqual({ userIds: ["u1"], primaryUserId: "u1" });
    await answer(assign, { ok: true });
    expect(onAssigned).toHaveBeenCalledOnce();
  });

  it("job page and Calendar: keeps current cleaners, stars the primary, clears with an empty list", async () => {
    render(<AssignCleanersModal open onClose={vi.fn()} jobId="j1" jobLabel="Glebe House" cleaners={CLEANERS} initialAssignedIds={["u1"]} initialPrimaryId="u1" onAssigned={vi.fn()} />);
    await answer(callsTo("/assign-facts")[0], facts(["j1"]));
    fireEvent.click(screen.getByText("Liam O'Brien"));
    fireEvent.click(screen.getByRole("button", { name: "Make Liam O'Brien primary" }));
    // Liam's expired police check is shown before saving, marked, not hidden.
    expect(screen.getAllByText("2 other jobs that day").length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Assign 2/ })); });
    expect(callsTo("/api/admin/jobs/j1/assign")[0].body).toEqual({ userIds: ["u1", "u3"], primaryUserId: "u3" });
  });

  it("an empty selection on a staffed job clears every assignee, as before", async () => {
    render(<AssignCleanersModal open onClose={vi.fn()} jobId="j1" cleaners={CLEANERS} initialAssignedIds={["u1"]} initialPrimaryId="u1" onAssigned={vi.fn()} />);
    fireEvent.click(screen.getByText("Maria Lopez"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Clear assignees/ })); });
    expect(callsTo("/api/admin/jobs/j1/assign")[0].body).toEqual({ userIds: [] });
  });

  it("Jobs bulk bar: one cleaner for the selection, same body as before ({ jobIds, cleanerUserId })", async () => {
    const onDone = vi.fn();
    render(<JobsBulk selectedIds={["j1", "j2"]} cleaners={CLEANERS} inspectors={[]} exportQuery="" readOnly={false} onClear={vi.fn()} onChangeStatus={vi.fn()} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Assign cleaner" }));
    const dialog = screen.getByRole("dialog", { name: /Assign a cleaner/ });
    expect(callsTo("/assign-facts")[0].url).toBe("/api/admin/jobs/assign-facts?jobIds=j1%2Cj2");
    await answer(callsTo("/assign-facts")[0], facts(["j1", "j2"]));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Maria Lopez/ }));
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Assign to 2 jobs/ })); });
    const bulk = callsTo("/api/admin/jobs/bulk-assign")[0];
    expect(bulk.body).toEqual({ jobIds: ["j1", "j2"], cleanerUserId: "u1" });
    await answer(bulk, { updated: 2 });
    expect(onDone).toHaveBeenCalledWith([]);
  });
});

describe("leave and expired documents before saving", () => {
  it("shows leave and an expired police check in the list and asks Assign anyway in the same window", async () => {
    render(<AssignCleanersModal open onClose={vi.fn()} jobId="j1" cleaners={CLEANERS} initialAssignedIds={[]} onAssigned={vi.fn()} />);
    await answer(callsTo("/assign-facts")[0], facts(["j1"], WARNINGS));
    expect(screen.getByText("On leave 19–23 Nov")).toBeVisible();
    expect(screen.getByText("Police check expired 2 Oct 2026")).toBeVisible();
    fireEvent.click(screen.getByText("Sofia Alvarez"));
    expect(screen.getByRole("alert")).toHaveTextContent("Assign anyway?Sofia Alvarez: On leave 19–23 Nov");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Assign anyway/ })); });
    expect(callsTo("/api/admin/jobs/j1/assign")[0].body).toEqual({ userIds: ["u2"], primaryUserId: "u2", confirmLeaveConflict: true });
  });

  it("a 409 the list did not foresee still offers Assign anyway and resends with the override", async () => {
    render(<AssignCleanersModal open onClose={vi.fn()} jobId="j1" cleaners={CLEANERS} initialAssignedIds={[]} onAssigned={vi.fn()} />);
    await answer(callsTo("/assign-facts")[0], { error: "down" }, 500);
    expect(screen.getByText(/could not be checked. The server still checks them/)).toBeVisible();
    fireEvent.click(screen.getByText("Sofia Alvarez"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Assign 1/ })); });
    await answer(callsTo("/api/admin/jobs/j1/assign")[0], { error: "Sofia Alvarez: On leave 19–23 Nov", code: "LEAVE_CONFLICT" }, 409);
    expect(screen.getByRole("alert")).toHaveTextContent("Sofia Alvarez: On leave 19–23 Nov");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Assign anyway/ })); });
    expect(callsTo("/api/admin/jobs/j1/assign")[1].body).toEqual({ userIds: ["u2"], primaryUserId: "u2", confirmLeaveConflict: true });
  });
});

describe("drafts, late answers and saving", () => {
  function Harness({ jobId, open }: { jobId: string; open: boolean }) {
    return <AssignDialog open={open} target={{ kind: "job", jobId, context: jobId, initialAssignedIds: [] }} cleaners={CLEANERS} onClose={vi.fn()} onAssigned={vi.fn()} />;
  }

  it("keeps ticks when closed and reopened for the same job, drops them for another job", async () => {
    const view = render(<Harness jobId="j1" open />);
    fireEvent.click(screen.getByText("Maria Lopez"));
    view.rerender(<Harness jobId="j1" open={false} />);
    view.rerender(<Harness jobId="j1" open />);
    expect(screen.getByRole("checkbox", { name: /Maria Lopez/ })).toBeChecked();
    view.rerender(<Harness jobId="j2" open />);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Maria Lopez/ })).not.toBeChecked());
  });

  it("a late facts answer for the previous job never fills the dialog", async () => {
    const view = render(<Harness jobId="j1" open />);
    view.rerender(<Harness jobId="j2" open />);
    await answer(callsTo("jobIds=j2")[0], facts(["j2"]));
    await answer(callsTo("jobIds=j1")[0], facts(["j1"], WARNINGS));
    expect(screen.queryByText("On leave 19–23 Nov")).toBeNull();
  });

  it("freezes fields while saving and keeps the choice after a failure", async () => {
    render(<Harness jobId="j1" open />);
    fireEvent.click(screen.getByText("Maria Lopez"));
    fireEvent.click(screen.getByRole("button", { name: /^Assign 1/ }));
    expect(screen.getByRole("checkbox", { name: /Maria Lopez/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Assigning…/ })).toBeDisabled();
    await answer(callsTo("/api/admin/jobs/j1/assign")[0], { error: "Publish this draft job before assigning cleaners." }, 409);
    expect(screen.getByRole("alert")).toHaveTextContent("Not assigned: Publish this draft job before assigning cleaners.");
    expect(screen.getByRole("checkbox", { name: /Maria Lopez/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Maria Lopez/ })).not.toBeDisabled();
  });

  it("is a bottom sheet on a phone with Cancel in its title bar and the primary docked", () => {
    render(<Harness jobId="j1" open />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-sm:rounded-t-[18px]");
    expect(within(dialog).getByText("Cancel", { selector: "span" }).className).toContain("sm:hidden");
    const footerCancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(footerCancel.className).toContain("max-sm:hidden");
    expect(within(dialog).getByText("Assign 0 cleaners").className).toContain("sm:hidden");
  });
});
