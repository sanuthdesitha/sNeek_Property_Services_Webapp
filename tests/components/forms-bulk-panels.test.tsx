import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BulkQuestionPanel } from "@/components/v2/admin/forms/library/bulk-question-panel";

const m = vi.hoisted(() => ({ fetch: vi.fn(), applied: vi.fn() }));
const question = { key: "k", match: { kind: "wording", section: "Kitchen", label: "Oven cleaned inside", type: "photo" }, formCount: 2, repeatedIn: 0 };
const outcome = (status: string) => ({
  dryRun: status === "would-change",
  operation: "edit-question",
  outcomes: [
    { templateId: "a", name: "Alpha", status, changes: [{ sectionTitle: "Kitchen", fieldId: "oven", fieldLabel: "Oven cleaned inside", property: "minPhotos", before: 1, after: 2 }], draftSaved: status === "changed" },
    { templateId: "b", name: "Bravo", status: "unchanged", reason: "\"Oven cleaned inside\" (photo) is not in this form.", changes: [] },
  ],
  summary: { changed: 1, unchanged: 1, refused: 0 },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).includes("/questions")) return { ok: true, status: 200, json: async () => ({ formCount: 2, questions: [question] }) };
    const body = JSON.parse(String(init?.body));
    return { ok: true, status: 200, json: async () => outcome(body.dryRun ? "would-change" : "changed") };
  });
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("offers only questions in the selection and saves drafts only after a matching preview", async () => {
  render(<BulkQuestionPanel templateIds={["a", "b"]} onApplied={m.applied} />);
  const picker = screen.getByLabelText("Question");
  await screen.findByRole("option", { name: /Kitchen: Oven cleaned inside \(in 2 of 2\)/ });
  expect(String(m.fetch.mock.calls[0][0])).toContain("ids=a%2Cb");
  fireEvent.change(picker, { target: { value: "k" } });
  fireEvent.change(screen.getByLabelText("New value"), { target: { value: "2" } });
  const save = screen.getByRole("button", { name: "Save as drafts" });
  expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
  expect(await screen.findByText("Bravo")).toBeVisible();
  expect(screen.getByText(/is not in this form/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Preview 1 change" })).toBeEnabled();
  // Changing the value invalidates the preview: Save waits for a new one.
  fireEvent.change(screen.getByLabelText("New value"), { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "Save as drafts" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("New value"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as drafts" }));
  await waitFor(() => expect(m.applied).toHaveBeenCalledOnce());
  const applyBody = JSON.parse(String(m.fetch.mock.calls.at(-1)?.[1]?.body));
  expect(applyBody).toMatchObject({ templateIds: ["a", "b"], dryRun: false, operation: { type: "edit-question", edit: { property: "minPhotos", value: 2 } } });
  expect(await screen.findByText("Saved as draft")).toBeVisible();
});

it("rejects an out-of-range value before any request", async () => {
  render(<BulkQuestionPanel templateIds={["a"]} onApplied={m.applied} />);
  await screen.findByRole("option", { name: /Oven cleaned inside/ });
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: "k" } });
  fireEvent.change(screen.getByLabelText("New value"), { target: { value: "50" } });
  expect(screen.getByRole("button", { name: "Preview changes" })).toBeDisabled();
  expect(screen.getByText("Enter a whole number from 0 to 20.")).toBeVisible();
});
