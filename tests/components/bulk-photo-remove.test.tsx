import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkPhotoAssign } from "@/components/v2/cleaner/bulk-photo-assign";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
const mocks = vi.hoisted(() => ({ remove: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-client", () => ({ moveEvidence: vi.fn(), removeEvidence: mocks.remove }));
vi.mock("@/components/v2/cleaner/media-capture", () => ({ prepareAndUploadFiles: mocks.upload }));
const scope = { jobId: "job", templateId: "template", formRevision: "revision", draftIdentity: "actor" };
const photo = (key: string) => ({ key, url: `/${key}.jpg`, kind: "image" as const, name: key });
function Harness({ currentScope = scope }: { currentScope?: typeof scope | null }) {
  const [pool, setPool] = React.useState([photo("one"), photo("two")]);
  const [uploads, setUploads] = React.useState({});
  return <EvidenceContext.Provider value={currentScope}><button onClick={() => setPool(current => [...current, photo("new")])}>Concurrent upload</button><output data-testid="pool">{pool.map(item => item.key).join(",")}</output><BulkPhotoAssign open onClose={vi.fn()} pool={pool} setPool={setPool} uploads={uploads} setUploads={setUploads} fields={[]} /></EvidenceContext.Provider>;
}
beforeEach(() => { vi.resetAllMocks(); mocks.remove.mockResolvedValue(undefined); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("offers an accessible per-photo control and cancel leaves the draft intact", () => {
  vi.mocked(window.confirm).mockReturnValue(false); render(<Harness />);
  const button = screen.getByRole("button", { name: "Remove one from draft" });
  expect(button.className).toContain("min-h-11"); fireEvent.click(button);
  expect(mocks.remove).not.toHaveBeenCalled(); expect(screen.getByTestId("pool")).toHaveTextContent("one,two");
});
it("waits for acknowledgement, ignores repeated clicks and preserves concurrent photos", async () => {
  let resolve!: () => void; mocks.remove.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  render(<Harness />); const button = screen.getByRole("button", { name: "Remove one from draft" });
  fireEvent.click(button); fireEvent.click(button); expect(mocks.remove).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("pool")).toHaveTextContent("one,two");
  fireEvent.click(screen.getByText("Concurrent upload")); await act(async () => resolve());
  expect(screen.getByTestId("pool")).toHaveTextContent("two,new");
});
it("keeps the photo on failure and allows retry", async () => {
  mocks.remove.mockRejectedValueOnce(new Error("Offline. Retry.")); render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Remove one from draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Offline. Retry.");
  expect(screen.getByTestId("pool")).toHaveTextContent("one,two");
  fireEvent.click(screen.getByRole("button", { name: "Remove one from draft" }));
  await waitFor(() => expect(screen.getByTestId("pool").textContent).toBe("two"));
});
it("does not mutate a changed account context after an in-flight response", async () => {
  let resolve!: () => void; mocks.remove.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  const view = render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Remove one from draft" }));
  view.rerender(<Harness currentScope={{ ...scope, draftIdentity: "other" }} />);
  await act(async () => resolve()); expect(screen.getByTestId("pool")).toHaveTextContent("one,two");
});
it("disables removal during upload and preserves the new upload", async () => {
  let resolve!: (value: any) => void; mocks.upload.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<Harness />); fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: [new File(["fixture"], "new.jpg", { type: "image/jpeg" })] } });
  expect(screen.getByRole("button", { name: "Remove one from draft" })).toBeDisabled();
  await act(async () => resolve({ results: [photo("new")], failedCount: 0 }));
  expect(screen.getByRole("button", { name: "Remove one from draft" })).toBeEnabled();
  expect(screen.getByTestId("pool")).toHaveTextContent("one,two,new");
});
it("hides removal without an active evidence scope", () => { render(<Harness currentScope={null} />); expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull(); });

it("keeps only failed selections after a partially successful batch and safely retries", async () => {
  mocks.remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Retry second photo"));
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "one", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "two", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  await screen.findByText("Retry second photo");
  expect(screen.getByTestId("pool").textContent).toBe("two"); expect(screen.getByText("1 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove selected" }));
  await waitFor(() => expect(screen.getByTestId("pool").textContent).toBe(""));
  expect(mocks.remove.mock.calls.map(call => call[1])).toEqual(["one", "two", "two"]);
});

it("requires a separate confirmation to discard a wrong capture reference", async () => {
  mocks.remove.mockRejectedValueOnce(Object.assign(new Error("Different capture context"), { key: "one", canDiscardReference: true }));
  render(<Harness />); fireEvent.click(screen.getByRole("button", { name: "Remove one from draft" }));
  const discard = await screen.findByRole("button", { name: "Discard wrong draft reference" });
  vi.mocked(window.confirm).mockReturnValueOnce(false); fireEvent.click(discard); expect(mocks.remove).toHaveBeenCalledTimes(1);
  fireEvent.click(discard); await waitFor(() => expect(screen.getByTestId("pool").textContent).toBe("two"));
  expect(mocks.remove.mock.calls[1][2]).toContain("does not belong to this job");
});
it("does not copy a late upload into a different job/account context", async () => {
  let resolve!: (value: any) => void; mocks.upload.mockImplementation(() => new Promise(r => { resolve = r; }));
  const view = render(<Harness />); fireEvent.change(screen.getByLabelText("Choose photos"), { target: { files: [new File(["fixture"], "old.jpg", { type: "image/jpeg" })] } });
  view.rerender(<Harness currentScope={{ ...scope, jobId: "other-job", draftIdentity: "other" }} />);
  await act(async () => resolve({ results: [photo("old-job-upload")], failedCount: 0 }));
  expect(screen.getByTestId("pool").textContent).toBe("one,two"); expect(screen.getByRole("button", { name: "Remove one from draft" })).toBeEnabled();
});
