// Wave B builder: rename the form in place in the header (one h1, Enter saves,
// Escape cancels, metadata PATCH with the stale-write guard).
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineFormName } from "@/components/v2/admin/forms/builder/inline-form-name";
import { useInlineRename } from "@/components/v2/admin/forms/builder/use-inline-rename";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InlineFormName", () => {
  it("stays one h1, saves on Enter and cancels on Escape", async () => {
    const onRename = vi.fn().mockResolvedValue({ ok: true });
    render(<InlineFormName name="Airbnb turnover" onRename={onRename}><span>Live v14</span></InlineFormName>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Rename form" }));
    const box = screen.getByRole("textbox", { name: "Form name" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.change(box, { target: { value: "Changed" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Airbnb turnover")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rename form" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Form name" }), { target: { value: "  Airbnb standard  " } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Form name" }), { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Airbnb standard"));
  });
  it("keeps the typed name and says why when the save is refused", async () => {
    const onRename = vi.fn().mockResolvedValue({ ok: false, error: "This form was changed elsewhere." });
    render(<InlineFormName name="Old" onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename form" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Form name" }), { target: { value: "New" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Form name" }), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere");
    expect((screen.getByRole("textbox", { name: "Form name" }) as HTMLInputElement).value).toBe("New");
  });
});

function setup(hasDraft: boolean, response: { status: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({ status: response.status, ok: response.status < 300, json: async () => response.body });
  vi.stubGlobal("fetch", fetchMock);
  const document = { edit: vi.fn() } as never;
  const autosave = { state: { status: "saved" }, currentToken: () => "draft-or-row-token", adoptNextRevision: vi.fn() } as never;
  const { result } = renderHook(() => useInlineRename({ templateId: "t1", document, autosave, initialTemplateToken: "2026-11-01T00:00:00.000Z", hasDraft }));
  return { result, fetchMock, document: document as unknown as { edit: ReturnType<typeof vi.fn> }, autosave: autosave as unknown as { adoptNextRevision: ReturnType<typeof vi.fn> } };
}

describe("useInlineRename", () => {
  it("without a draft: guards with the row token, then adopts the new token so no draft is created", async () => {
    const { result, fetchMock, document, autosave } = setup(false, { status: 200, body: { updatedAt: "2026-11-12T00:00:00.000Z" } });
    let outcome: unknown;
    await act(async () => { outcome = await result.current("New name"); });
    expect(outcome).toEqual({ ok: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "New name", expectedUpdatedAt: "draft-or-row-token" });
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(autosave.adoptNextRevision).toHaveBeenCalledWith("2026-11-12T00:00:00.000Z");
    expect(document.edit).toHaveBeenCalledTimes(1);
  });
  it("with a draft: guards with the template row's own token and edits the draft name", async () => {
    const { result, fetchMock, autosave, document } = setup(true, { status: 200, body: { updatedAt: "2026-11-12T00:00:00.000Z" } });
    await act(async () => { await result.current("New name"); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).expectedUpdatedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(autosave.adoptNextRevision).not.toHaveBeenCalled();
    expect(document.edit).toHaveBeenCalledTimes(1);
  });
  it("a stale write (409) changes nothing", async () => {
    const { result, document } = setup(false, { status: 409, body: { code: "STALE_TEMPLATE" } });
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => { outcome = await result.current("New name"); });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/changed elsewhere/);
    expect(document.edit).not.toHaveBeenCalled();
  });
});
