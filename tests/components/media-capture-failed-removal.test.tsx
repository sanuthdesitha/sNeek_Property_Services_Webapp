import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
const m = vi.hoisted(() => ({ rows: new Map<string, any>(), cancel: vi.fn(), process: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", () => ({ getEvidence: async (id: string) => m.rows.get(id), listEvidence: async () => Array.from(m.rows.values()), putEvidence: async (row: any) => { m.rows.set(row.id, row); } }));
vi.mock("@/lib/cleaner/evidence-client", () => ({ processEvidence: m.process, cancelPendingEvidence: m.cancel }));
vi.mock("@/lib/cleaner/evidence-volatile", () => ({ getVolatileEvidence: () => [], retainVolatileEvidence: vi.fn(), releaseVolatileEvidence: m.release }));
vi.mock("@/lib/uploads/capture-advice", () => ({ deviceStorageAdvice: async () => [], inspectImageCapture: async () => [] }));
import { MediaCapture } from "@/components/v2/cleaner/media-capture";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
const scope = { jobId: "job", draftIdentity: "identity", templateId: "template", formRevision: "revision" };
const file = new File(["original-video"], "failed.mp4", { type: "video/mp4" });
beforeEach(() => { vi.clearAllMocks(); m.rows.clear(); m.process.mockRejectedValue(new Error("Network interrupted")); });
function view(disabled = false, onChange = vi.fn()) {
  return <EvidenceContext.Provider value={scope}><MediaCapture value={[]} onChange={onChange} evidenceFieldId="video" mode="video" disabled={disabled} /></EvidenceContext.Provider>;
}
async function failUpload(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByText("1 file did not upload");
}
it("keeps failed upload visible until cancellation acknowledgement and retains original", async () => {
  let acknowledge!: () => void;
  m.cancel.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  const { container } = render(view()); await failUpload(container);
  const record = Array.from(m.rows.values())[0]; expect(record.blob).toBe(file);
  fireEvent.click(screen.getByRole("button", { name: "Remove failed upload" }));
  await waitFor(() => expect(m.cancel).toHaveBeenCalledWith(record, scope));
  expect(screen.getByText("1 file did not upload")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove failed upload" })).toBeDisabled();
  await act(async () => acknowledge());
  await waitFor(() => expect(screen.queryByText("1 file did not upload")).not.toBeInTheDocument());
  expect(screen.getByText("Failed upload removed. Its original is available in device recovery.")).toBeInTheDocument();
  expect(m.rows.get(record.id).blob).toBe(file);
  expect(m.rows.size).toBe(1);
});
it("retains failed row and original when cancellation is rejected", async () => {
  m.cancel.mockRejectedValue(new Error("Removal was not confirmed"));
  const { container } = render(view()); await failUpload(container);
  fireEvent.click(screen.getByRole("button", { name: "Remove failed upload" }));
  await screen.findByText("Removal was not confirmed");
  expect(screen.getByText("1 file did not upload")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove failed upload" })).toBeEnabled();
  expect(Array.from(m.rows.values())[0].blob).toBe(file);
});
it("preserves media added while cancellation acknowledgement is pending", async () => {
  let acknowledge!: (key: string) => void;
  m.cancel.mockImplementation(() => new Promise<string>(resolve => { acknowledge = resolve; }));
  const onChange = vi.fn();
  const { container, rerender } = render(view(false, onChange)); await failUpload(container);
  fireEvent.click(screen.getByRole("button", { name: "Remove failed upload" }));
  await waitFor(() => expect(m.cancel).toHaveBeenCalled());
  const newer = { key: "new-photo", url: "/photo", kind: "image" as const, name: "new.jpg" };
  rerender(<EvidenceContext.Provider value={scope}><MediaCapture value={[newer]} onChange={onChange} evidenceFieldId="video" mode="video" /></EvidenceContext.Provider>);
  await act(async () => acknowledge("old-video"));
  expect(onChange).toHaveBeenLastCalledWith([newer]);
});
it("disables retry and removal when an existing failed capture becomes read-only", async () => {
  const { container, rerender } = render(view()); await failUpload(container);
  rerender(view(true));
  expect(screen.getByRole("button", { name: "Remove failed upload" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Retry it" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Remove failed upload" }));
  expect(m.cancel).not.toHaveBeenCalled();
  expect(container.querySelector('input[type="file"]')).toBeDisabled();
});
