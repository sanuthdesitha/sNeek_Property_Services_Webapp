/**
 * The three confirmation tiers and the one credential field (board
 * "Confirmations and deletes", approved 2026-11-14).
 *
 *   A ordinary:     one sentence + Confirm; focus starts on Confirm.
 *   B destructive:  one line + red button; focus starts on Cancel; Undo toast.
 *   C sensitive:    one credential field with five states (PIN, wrong PIN with
 *                   tries left, locked, no PIN yet → password, testing as
 *                   someone else → not available), optional quick-pick reason
 *                   and "Add details" disclosure. Nobody types a word.
 * Phone: a bottom sheet with the confirm button full width under Cancel, 44px
 * targets and a numeric keypad for the PIN.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EConfirmDialog, type ConfirmTier } from "@/components/v2/ui/confirm-dialog";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { undoToast } from "@/components/v2/ui/undo-toast";
import { Toaster } from "@/components/ui/toaster";
import { OTHER_REASON_ID, REASON_CHOICES, composeReason } from "@/lib/confirmations/reasons";
import { RemoveLineDialog, lineCanBeRestored } from "@/components/v2/admin/finance/invoices/editor/editor-line-dialogs";
import type { EditorLine } from "@/lib/billing/client-invoice-editor-types";

type PinBody = Record<string, unknown>;
let pinAnswer: { status: number; body: PinBody } = { status: 200, body: { hasPin: true, lockedUntil: null, userId: "u1", attemptsLeft: 5 } };
let pinReads = 0;

beforeEach(() => {
  pinReads = 0;
  pinAnswer = { status: 200, body: { hasPin: true, lockedUntil: null, userId: "u1", attemptsLeft: 5 } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/me/admin-pin") {
      pinReads += 1;
      return new Response(JSON.stringify(pinAnswer.body), { status: pinAnswer.status });
    }
    return new Response("{}");
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ tier, onConfirm, reason = false, details = false }: { tier: ConfirmTier; onConfirm: (result: unknown) => unknown; reason?: boolean; details?: boolean }) {
  const [open, setOpen] = React.useState(true);
  const [note, setNote] = React.useState("");
  return (
    <EConfirmDialog
      open={open}
      onClose={() => setOpen(false)}
      tier={tier}
      title="Void INV-2038?"
      description="It stops counting as owed."
      confirmLabel="Void invoice"
      reason={reason ? { label: "Reason", choices: REASON_CHOICES.invoiceVoid } : undefined}
      details={details ? { label: "Add details: note", content: <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label> } : undefined}
      onConfirm={onConfirm as never}
    />
  );
}

describe("tier A, ordinary", () => {
  it("is one sentence and Confirm, with focus on the confirm button and no credential or typed word", async () => {
    const onConfirm = vi.fn();
    render(<Harness tier="ordinary" onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog", { name: "Void INV-2038?" });
    expect(dialog).toHaveTextContent("Please confirm");
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" });
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByLabelText(/Your PIN|Type/)).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({}));
    expect(pinReads).toBe(0);
  });
});

describe("tier B, removes something", () => {
  it("starts focus on Cancel so Enter never deletes, and the button is red", async () => {
    render(<Harness tier="destructive" onConfirm={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Removes something");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(within(dialog).getByRole("button", { name: "Void invoice" }).className).toMatch(/e-danger/);
    expect(within(dialog).queryByLabelText(/Your PIN/)).toBeNull();
  });

  it("offers Undo for ten seconds through the toast, which calls back once", async () => {
    const onUndo = vi.fn();
    render(<Toaster />);
    act(() => {
      undoToast({ title: "Question deleted", onUndo });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("EConfirmModal ignores the retired confirmPhrase: no typed word is asked", async () => {
    const onConfirm = vi.fn();
    render(<EConfirmModal open title="Delete case?" confirmPhrase="DELETE" confirmLabel="Delete case" onClose={vi.fn()} onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Type DELETE/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete case" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
  });
});

describe("tier C, the credential field", () => {
  it("has a PIN: one field, number pad, Show, confirm only once entered, sends { pin }", async () => {
    const onConfirm = vi.fn();
    render(<Harness tier="sensitive" onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Sensitive · your PIN");
    const field = await within(dialog).findByLabelText("Your PIN");
    expect(field).toHaveAttribute("inputmode", "numeric");
    expect(field).toHaveAttribute("type", "password");
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" });
    expect(confirm).toBeDisabled();
    fireEvent.change(field, { target: { value: "48a26" } });
    expect(field).toHaveValue("4826");
    fireEvent.click(within(dialog).getByRole("button", { name: "Show PIN" }));
    expect(field).toHaveAttribute("type", "text");
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ credentials: { pin: "4826" } }));
  });

  it("wrong PIN: the field clears, says how many tries are left, and the picked reason stays", async () => {
    const onConfirm = vi.fn(async () => {
      pinAnswer = { status: 200, body: { hasPin: true, lockedUntil: null, userId: "u1", attemptsLeft: 3 } };
    });
    render(<Harness tier="sensitive" reason onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Wrong client" }));
    fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "0000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void invoice" }));
    expect(await within(dialog).findByText("That PIN is not right. 3 tries left.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your PIN")).toHaveValue("");
    expect(within(dialog).getByRole("radio", { name: "Wrong client" })).toBeChecked();
    expect(onConfirm).toHaveBeenCalledWith({ credentials: { pin: "0000" }, reason: "Wrong client" });
  });

  it("locked: the field says until when and the button stays off", async () => {
    const until = new Date(Date.now() + 14 * 60_000).toISOString();
    pinAnswer = { status: 200, body: { hasPin: true, lockedUntil: until, userId: "u1", attemptsLeft: 5 } };
    render(<Harness tier="sensitive" onConfirm={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Too many wrong tries\. Try again at/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your PIN")).toHaveValue("Locked");
    expect(within(dialog).getByLabelText("Your PIN")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Void invoice" })).toBeDisabled();
  });

  it("no PIN yet: the account password confirms this time, with a Set a PIN link", async () => {
    pinAnswer = { status: 200, body: { hasPin: false, lockedUntil: null, userId: "u1", attemptsLeft: 5 } };
    const onConfirm = vi.fn();
    render(<Harness tier="sensitive" onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    const field = await within(dialog).findByLabelText("Your password");
    expect(dialog).toHaveTextContent("Sensitive · your password");
    expect(within(dialog).getByRole("link", { name: "Set a PIN" })).toHaveAttribute("href", "/v2/admin/profile#own-pin");
    expect(within(dialog).queryByLabelText(/Choose your PIN/)).toBeNull();
    fireEvent.change(field, { target: { value: "correct horse" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void invoice" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ credentials: { password: "correct horse" } }));
  });

  it("testing as someone else: not available, no credential can be sent", async () => {
    pinAnswer = { status: 403, body: { error: "Stop testing as someone else to change your own PIN.", code: "ACTUAL_ACTOR_REQUIRED" } };
    render(<Harness tier="sensitive" onConfirm={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Stop testing as someone else to do this\. It needs your own PIN\./)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your PIN")).toHaveValue("Not available");
    expect(within(dialog).getByRole("button", { name: "Void invoice" })).toBeDisabled();
  });
});

describe("quick-pick reason and Add details", () => {
  it("needs a pick; Other needs any text (no minimum length)", async () => {
    const onConfirm = vi.fn();
    render(<Harness tier="ordinary" reason onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" });
    expect(within(dialog).getByRole("radiogroup", { name: /Reason/ })).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Other…" }));
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Say why"), { target: { value: "x" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ reason: "x" }));
  });

  it("keeps details typed under a collapsed disclosure", async () => {
    render(<Harness tier="ordinary" details onConfirm={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("button", { name: "Add details: note" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    fireEvent.change(within(dialog).getByLabelText("Note"), { target: { value: "CN-00412" } });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(within(dialog).getByLabelText("Note")).toHaveValue("CN-00412");
  });

  it("composes the reason text from the choice, Other text and a detail", () => {
    const choices = REASON_CHOICES.xeroReconcile;
    expect(composeReason(choices, { choice: "voided-in-xero", note: "" }, "CN-1")).toBe("Voided in Xero · CN-1");
    expect(composeReason(choices, { choice: OTHER_REASON_ID, note: "  " })).toBeNull();
    expect(composeReason(choices, { choice: null, note: "x" })).toBeNull();
  });
});

describe("phone", () => {
  it("is a bottom sheet with Cancel above a full-width confirm and 44px targets", async () => {
    render(<Harness tier="sensitive" onConfirm={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toMatch(/max-sm:rounded-t-\[18px\]/);
    expect(dialog.parentElement!.className).toMatch(/max-sm:items-end/);
    const confirm = within(dialog).getByRole("button", { name: "Void invoice" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(confirm.parentElement!.className).toMatch(/max-sm:flex-col/);
    expect(confirm.className).toMatch(/max-sm:w-full/);
    expect(confirm.className).toMatch(/max-sm:order-2/);
    expect(cancel.className).toMatch(/max-sm:order-1/);
    const field = await within(dialog).findByLabelText("Your PIN");
    expect(field.className).toMatch(/h-11/);
    expect(field.className).toMatch(/text-\[16px\]/);
    expect(field).toHaveAttribute("enterkeyhint", "done");
  });
});

describe("invoice line removal (owner default 2026-11-14)", () => {
  const line = { id: "l1", description: "Oven clean", quantity: 1, unitPrice: 40, lineTotal: 40, category: "SERVICE", note: null, shoppingLocked: false, discount: false, discountPercent: null, job: null, propertyId: null, property: null, startedWork: null } as EditorLine;

  it("on a DRAFT is tier B with no PIN and promises Undo for a plain manual line", async () => {
    const onConfirm = vi.fn();
    render(<RemoveLineDialog line={line} draft busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Removes something");
    expect(dialog).toHaveTextContent("You get Undo for 10 seconds.");
    expect(within(dialog).queryByLabelText("Your PIN")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove line" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(line, {}));
    expect(pinReads).toBe(0);
  });

  it("past DRAFT stays tier C with the PIN", async () => {
    const onConfirm = vi.fn();
    render(<RemoveLineDialog line={line} draft={false} busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "4826" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove line" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(line, { pin: "4826" }));
  });

  it("offers Undo only for lines it can put back exactly", () => {
    expect(lineCanBeRestored(line)).toBe(true);
    expect(lineCanBeRestored({ ...line, job: { id: "j", jobNumber: "J-1", scheduledDay: "2026-11-14", property: null } })).toBe(false);
    expect(lineCanBeRestored({ ...line, discount: true })).toBe(false);
    expect(lineCanBeRestored({ ...line, propertyId: "p" })).toBe(false);
  });
});
