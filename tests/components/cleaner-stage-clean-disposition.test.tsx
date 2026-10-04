import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/components/v2/cleaner/job-actions", () => ({ EarlyCheckoutStatus: () => null }));
vi.mock("@/components/v2/cleaner/form-renderer", () => ({ FormRenderer: () => null }));
vi.mock("@/components/v2/cleaner/bulk-photo-assign", () => ({ BulkPhotoAssign: () => null }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: ({ onChange, disabled, evidenceDestination }: any) => <button disabled={disabled} onClick={() => onChange([{ key: "proof.jpg", kind: "image" }])}>Capture {evidenceDestination.taskId}</button> }));
import { StageClean } from "@/components/v2/cleaner/job-stages/stage-clean";
afterEach(cleanup);
function Fixture({ optional = true, locked = false }: { optional?: boolean; locked?: boolean }) {
 const [draft, setDraft] = React.useState<any>({ decision: "OPEN", note: "", proof: [] });
 const api = { schema: null, answers: {}, uploads: {}, jobTasks: [{ id: "task", title: "Water plants", source: "ADMIN", metadata: { allowNotApplicable: optional } }], taskDrafts: { task: draft }, locked, property: {}, jobId: "job", setTask: (_id: string, patch: any) => setDraft({ ...draft, ...patch }) } as any;
 return <><StageClean api={api} /><output aria-label="Task draft">{JSON.stringify(draft)}</output></>;
}
it("requires a reason and photo for an explicitly optional task without offering carry-forward", () => {
 render(<Fixture />); fireEvent.click(screen.getByRole("button", { name: "Not applicable" }));
 const reason = screen.getByPlaceholderText("Why it does not apply (reason and photo required; no carry-forward)");
 expect(screen.getByText("Proof photo (required)")).toBeInTheDocument();
 fireEvent.change(reason, { target: { value: "No plants at this property" } }); fireEvent.click(screen.getByRole("button", { name: "Capture task" }));
 expect(JSON.parse(screen.getByLabelText("Task draft").textContent!)).toEqual({ decision: "NOT_APPLICABLE", note: "No plants at this property", proof: [{ key: "proof.jpg", kind: "image" }] });
});
it("keeps mandatory tasks unskippable and distinguishes not-done from completion", () => {
 render(<Fixture optional={false} />); expect(screen.queryByRole("button", { name: "Not applicable" })).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Not done" })); expect(screen.getByPlaceholderText("Reason it wasn't done (required)")).toBeInTheDocument();
 expect(screen.queryByRole("button", { name: "Capture task" })).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Done", exact: true })); expect(screen.getByRole("button", { name: "Capture task" })).toBeInTheDocument();
});
it("does not let a locked job change task disposition", () => {
 render(<Fixture locked />); expect(screen.getByRole("button", { name: "Not applicable" })).toBeDisabled();
 fireEvent.click(screen.getByRole("button", { name: "Not applicable" })); expect(JSON.parse(screen.getByLabelText("Task draft").textContent!).decision).toBe("OPEN");
});
