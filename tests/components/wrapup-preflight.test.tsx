import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StageWrapup } from "@/components/v2/cleaner/job-stages/stage-wrapup";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

const checks = vi.hoisted(() => ({ blockers: [] as string[] }));
vi.mock("@/components/v2/cleaner/use-submission-preflight", () => ({ useSubmissionPreflight: () => [...checks.blockers] }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: () => null }));
afterEach(() => { cleanup(); checks.blockers = []; });
function api(patch: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return { locked: false, status: "IN_PROGRESS", laundryEnabled: false, schema: null, answers: {}, uploads: {}, property: {}, jobTasks: [], taskDrafts: {}, allTasksDecided: true,
    busy: null, addressLine: "Test property", jobId: "job", carryHasNew: false, finalCheckupItems: [],
    requestSubmit: vi.fn(), setActiveStage: vi.fn(), ...patch } as unknown as WorkspaceApi;
}
describe("wrap-up preflight panel", () => {
  it("combines mandatory checklist and synchronization blockers with actionable text", () => {
    checks.blockers = ["2 evidence files still need attachment."];
    const model = api({ jobTasks: [{ id: "task" }] as any, allTasksDecided: false });
    render(<StageWrapup api={model} />);
    expect(screen.getByText("2 checks to finish")).toBeInTheDocument();
    expect(screen.getByText(checks.blockers[0])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit & clock out" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Mark every checklist/ }));
    expect(model.setActiveStage).toHaveBeenCalledWith(4);
    expect(model.requestSubmit).not.toHaveBeenCalled();
  });
  it("keeps unavailable form contracts visible and blocks submit", () => {
    render(<StageWrapup api={api({ payload: { formContractError: "The form changed. Reload to review it." } })} />);
    expect(screen.getByText(/The form changed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit & clock out" })).toBeDisabled();
  });
  it("shows a retry for unconfirmed drafts without clearing the current form", () => {
    const model = api({ draftSaveState: { phase: "error", message: "Draft save unconfirmed" }, retryDraftSave: vi.fn() });
    render(<StageWrapup api={model} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
    expect(model.retryDraftSave).toHaveBeenCalledOnce();
    expect(model.requestSubmit).not.toHaveBeenCalled();
  });
  it("waits for other in-flight actions and enables the existing submit flow after they finish", () => {
    const model = api({ busy: "pause" });
    const { rerender } = render(<StageWrapup api={model} />);
    expect(screen.getByRole("button", { name: "Submit & clock out" })).toBeDisabled();
    rerender(<StageWrapup api={{ ...model, busy: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit & clock out" }));
    expect(model.requestSubmit).toHaveBeenCalledOnce();
  });
});
