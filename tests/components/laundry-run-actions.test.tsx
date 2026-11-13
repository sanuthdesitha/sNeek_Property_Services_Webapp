/**
 * Laundry run Change state dialog (owner request 2026-11-14): the time starts
 * empty (never "now"), a later state cannot be saved without the real time,
 * who did it and a reason, blank figures are sent as null (never 0), the
 * version shown is sent, and a refused save keeps every answer. Bulk outcomes
 * list each run.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RunChangeStateDialog, type ChangeStateRun } from "@/components/v2/admin/laundry/run/run-change-state-dialog";
import { RunOutcomeList } from "@/components/v2/admin/laundry/run/run-void-dialogs";

afterEach(() => vi.unstubAllGlobals());

const run: ChangeStateRun = { taskId: "r1", expectedUpdatedAt: "2026-11-12T03:00:00.000Z", name: "The Bondi Studio", status: "CONFIRMED", pickedUpAt: null, droppedAt: null, onEmailedReport: false };

function renderDialog(onSaved = vi.fn()) {
  render(
    <RunChangeStateDialog runs={[run]} doneByOptions={[{ id: "tom", label: "Tom Becker, CleanCo" }]} skipReasons={[{ value: "NO_LINEN_USED", label: "No linen used" }]} timeZone="Australia/Sydney" onClose={vi.fn()} onSaved={onSaved} />,
  );
  return onSaved;
}

describe("Change state dialog", () => {
  it("starts with an empty time and refuses to save until the real time, who and a reason are given", () => {
    renderDialog();
    fireEvent.click(screen.getByLabelText(/Picked up, at the laundry/));
    const date = screen.getByLabelText("Picked up on") as HTMLInputElement;
    const time = screen.getByLabelText("at") as HTMLInputElement;
    expect(date.value).toBe("");
    expect(time.value).toBe("");
    const save = screen.getByRole("button", { name: "Save correction" });
    expect(save).toBeDisabled();
    fireEvent.change(date, { target: { value: "2026-11-12" } });
    fireEvent.change(time, { target: { value: "14:41" } });
    fireEvent.change(screen.getByLabelText("Done by"), { target: { value: "tom" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason, required/), { target: { value: "Tom had no signal" } });
    expect(save).not.toBeDisabled();
  });

  it("sends the version, the real time in the organisation's zone and null for blank figures; a refused save keeps the answers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "This run changed since you loaded it." }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = renderDialog();
    fireEvent.click(screen.getByLabelText(/Picked up, at the laundry/));
    fireEvent.change(screen.getByLabelText("Picked up on"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("at"), { target: { value: "14:41" } });
    fireEvent.change(screen.getByLabelText("Done by"), { target: { value: "tom" } });
    fireEvent.change(screen.getByLabelText(/Reason, required/), { target: { value: "Tom had no signal" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save correction" })); });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ items: [{ taskId: "r1", expectedUpdatedAt: run.expectedUpdatedAt }], target: "PICKED_UP", happenedAt: "2026-11-12T03:41:00.000Z", doneById: "tom", bagCount: null, weightKg: null, price: null, notifyTeam: false });
    expect(screen.getByRole("alert")).toHaveTextContent("changed since you loaded it");
    expect((screen.getByLabelText(/Reason, required/) as HTMLTextAreaElement).value).toBe("Tom had no signal");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("moving back needs the warning confirmed", () => {
    render(<RunChangeStateDialog runs={[{ ...run, status: "DROPPED", pickedUpAt: "2026-11-11T03:00:00.000Z", droppedAt: "2026-11-12T01:00:00.000Z" }]} doneByOptions={[]} skipReasons={[]} timeZone="Australia/Sydney" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Not picked up yet/));
    fireEvent.change(screen.getByLabelText(/Reason, required/), { target: { value: "Recorded on the wrong run" } });
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand, move it back/));
    expect(screen.getByRole("button", { name: "Save correction" })).not.toBeDisabled();
  });
});

describe("bulk outcomes", () => {
  it("names every run with its outcome", () => {
    render(<RunOutcomeList title="Void · 2 runs" okLabel="voided" names={{ a: "Coogee Terrace", b: "The Bondi Studio" }} outcomes={[{ taskId: "a", ok: true }, { taskId: "b", ok: false, message: "Only skipped or flagged runs can be voided." }]} onClose={vi.fn()} />);
    expect(screen.getByText(/1 voided · 1 not/)).toBeInTheDocument();
    expect(screen.getByText("The Bondi Studio").parentElement).toHaveTextContent("Only skipped or flagged runs can be voided.");
  });
});
