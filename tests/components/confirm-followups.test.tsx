/**
 * Follow-ups to "simpler confirmations" (2026-11-14):
 *  - classic pages' TwoStepConfirmDialog asks for no typed phrase, keeps the
 *    credential, and can carry a required quick-pick reason;
 *  - the classic checklist library sends the PIN with a module delete (the
 *    route verifies it since the tier C change);
 *  - admin Maintenance resolve / dismiss is a tier A confirm with an optional note.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { StatusNoteDialog } from "@/components/v2/admin/maintenance/maintenance-dialogs";
import ChecklistLibraryPage from "@/app/admin/checklists/library/page";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

let calls: Array<{ url: string; init?: RequestInit }> = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/me/admin-pin") return new Response(JSON.stringify({ hasPin: true, lockedUntil: null, userId: "a1", attemptsLeft: 5 }));
    if (url === "/api/admin/checklist-library") {
      return new Response(JSON.stringify({ modules: [{ id: "mod1", key: "kitchen", title: "Kitchen", category: "ROOM", appliesWhen: null, isActive: true, items: [] }], featureDefs: [], jobTypes: [] }));
    }
    return new Response(JSON.stringify({ ok: true }));
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("classic TwoStepConfirmDialog", () => {
  it("asks for no typed phrase, even when an old caller passes one, and still needs the PIN", async () => {
    const onConfirm = vi.fn();
    render(<TwoStepConfirmDialog open onOpenChange={vi.fn()} title="Delete account?" confirmPhrase="DELETE" actionKey="deleteUserAccount" confirmLabel="Delete" requireSecurityVerification onConfirm={onConfirm} />);
    expect(screen.queryByLabelText(/Type/)).toBeNull();
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();
    fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "4826" } });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ pin: "4826" }, undefined);
  });

  it("needs a quick-pick reason when given choices (no minimum length)", async () => {
    const onConfirm = vi.fn();
    render(<TwoStepConfirmDialog open onOpenChange={vi.fn()} title="Void INV-1?" confirmLabel="Void invoice" requireSecurityVerification reasonChoices={REASON_CHOICES.invoiceVoid} onConfirm={onConfirm} />);
    fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "4826" } });
    const confirm = screen.getByRole("button", { name: "Void invoice" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Other…" }));
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Say why"), { target: { value: "x" } });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ pin: "4826" }, "x");
  });

  it("an ordinary classic confirm (no credential) confirms straight away", () => {
    const onConfirm = vi.fn();
    render(<TwoStepConfirmDialog open onOpenChange={vi.fn()} title="Discard?" confirmPhrase="DISCARD" confirmLabel="Discard" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe("classic checklist library", () => {
  it("sends the PIN with a module delete for the route to verify", async () => {
    render(<ChecklistLibraryPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Kitchen" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(await within(dialog).findByLabelText("Your PIN"), { target: { value: "4826" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete module" }));
    await waitFor(() => expect(calls.some((call) => call.init?.method === "DELETE")).toBe(true));
    const remove = calls.find((call) => call.init?.method === "DELETE")!;
    expect(remove.url).toBe("/api/admin/checklist-library/mod1");
    expect(JSON.parse(String(remove.init?.body))).toEqual({ security: { pin: "4826" } });
  });
});

describe("admin Maintenance resolve / dismiss", () => {
  it("is tier A with an optional note; a failure keeps the note and says nothing changed", async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<StatusNoteDialog request={{ kind: "RESOLVED", count: 2, title: null }} onClose={vi.fn()} onConfirm={onConfirm} />);
    const dialog = await screen.findByRole("dialog", { name: "Mark 2 items resolved?" });
    expect(dialog).toHaveTextContent("Please confirm");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark resolved" }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(null));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Nothing was changed");
    fireEvent.change(within(dialog).getByLabelText("Note for the history, optional"), { target: { value: "Fixed by the plumber" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark resolved" }));
    await waitFor(() => expect(onConfirm).toHaveBeenLastCalledWith("Fixed by the plumber"));
  });
});
