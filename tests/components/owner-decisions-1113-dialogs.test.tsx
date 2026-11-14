/**
 * Owner decisions 2026-11-13, the dialogs:
 *  1. Void invoice asks for the person's own PIN and sends it with the void;
 *  2. Revoke invitation confirms first and reports refusals;
 *  3. Move to team offers only the same client's teams and states Loses / Gains.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VoidInvoiceDialog } from "@/components/v2/admin/finance/invoices/correction-dialogs";
import { RevokeInvitationDialog } from "@/components/v2/admin/people/revoke-invitation-dialog";
import { MoveTeamDialog } from "@/components/v2/admin/people/assistants/move-team-dialog";
import { emptyVaPermissions } from "@/lib/va/permissions";
import type { AssistantTeam } from "@/lib/people/assistants";
import type { InvoiceRow } from "@/components/v2/admin/finance/invoices/invoice-model";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  answer = { status: 200, body: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/me/admin-pin") return new Response(JSON.stringify({ hasPin: true, lockedUntil: null, userId: "ops-1" }));
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Void invoice", () => {
  const invoice = { id: "inv-1", invoiceNumber: "INV-0042", status: "SENT", kind: "INVOICE" } as InvoiceRow;

  // 2026-11-14: a quick-pick reason is required as well (owner default, pending confirmation).
  it("cannot be confirmed without a reason and the own PIN, and sends both with the void", async () => {
    const onDone = vi.fn();
    render(<VoidInvoiceDialog invoice={invoice} onClose={vi.fn()} onDone={onDone} />);
    const confirm = await screen.findByRole("button", { name: "Void invoice" });
    expect(confirm).toBeDisabled();
    fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "4826" } });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Wrong client" }));
    fireEvent.click(screen.getByRole("button", { name: "Void invoice" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const voidCall = calls.find((call) => call.url === "/api/admin/invoices/inv-1");
    expect(JSON.parse(String(voidCall?.init?.body))).toEqual({ status: "VOID", voidReason: "Wrong client", security: { pin: "4826" } });
  });
});

describe("Revoke invitation", () => {
  it("confirms, then reports each refusal of a bulk revoke", async () => {
    answer = { status: 200, body: { revoked: 1, results: [{ userId: "a", outcome: "revoked", error: null }, { userId: "b", outcome: "refused", error: "The invitation was already accepted." }] } };
    const onDone = vi.fn();
    render(<RevokeInvitationDialog targets={[{ userId: "a", label: "Ana" }, { userId: "b", label: "Ben" }]} onClose={vi.fn()} onDone={onDone} />);
    const dialog = screen.getByRole("dialog", { name: "Revoke 2 invitations?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke 2" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ok: false, message: "Revoked 1 of 2. Not revoked: Ben: The invitation was already accepted." }));
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ userIds: ["a", "b"] });
  });

  it("keeps the dialog open with the reason when one revoke is refused", async () => {
    answer = { status: 403, body: { error: "You cannot send account emails to someone whose role is above yours." } };
    const onDone = vi.fn();
    render(<RevokeInvitationDialog targets={[{ userId: "a", label: "Ana" }]} onClose={vi.fn()} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("role is above yours");
    expect(onDone).not.toHaveBeenCalled();
    expect(calls[0].url).toBe("/api/admin/users/a/account-emails/revoke-invitation");
  });
});

describe("Move to team", () => {
  const team = (id: string, clientId: string, overrides: Partial<AssistantTeam> = {}): AssistantTeam => ({
    id, name: `Team ${id}`, isActive: true, client: { id: clientId, name: `Client ${clientId}`, propertyCount: 2 }, createdAt: "2026-11-01T00:00:00Z", createdByName: null,
    permissions: emptyVaPermissions(), grantedCount: 0, propertyIds: null, properties: [{ id: "p1", name: "Harbour" }, { id: "p2", name: "Hill" }], members: [], activity: [], ...overrides,
  });
  const member = { id: "va-1", name: "Vera", email: "v@x.invalid", status: "ACTIVE" as const, invitedAt: null, inviteExpiresAt: null, lastSeenAt: null };

  it("offers only the same client's teams, states the change and moves", async () => {
    const from = team("a", "c1", { permissions: { ...emptyVaPermissions(), bookings: true }, propertyIds: ["p1"] });
    const to = team("b", "c1", { permissions: { ...emptyVaPermissions(), maintenance: true } });
    const other = team("z", "c2");
    const onMoved = vi.fn();
    answer = { status: 200, body: {} };
    render(<MoveTeamDialog member={member} from={from} teams={[from, to, other]} onClose={vi.fn()} onMoved={onMoved} />);
    const select = screen.getByRole("combobox", { name: "Team of Client c1" });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(["Team b"]);
    expect(screen.getByText(/Loses:/).parentElement).toHaveTextContent("Loses: Bookings");
    expect(screen.getByText(/Gains:/).parentElement).toHaveTextContent("Gains: Maintenance");
    expect(screen.getByText("Properties: from Harbour to every property of the client.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Move assistant" }));
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(calls[0].url).toBe("/api/admin/va-teams/a/members/va-1");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ toTeamId: "b", confirmInactive: false });
  });

  it("needs a tick for a switched-off team", () => {
    const from = team("a", "c1");
    const off = team("b", "c1", { isActive: false });
    render(<MoveTeamDialog member={member} from={from} teams={[from, off]} onClose={vi.fn()} onMoved={vi.fn()} />);
    const move = screen.getByRole("button", { name: "Move assistant" });
    expect(move).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(move).toBeEnabled();
  });
});
