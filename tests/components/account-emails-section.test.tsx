/**
 * Accounts › Account emails section: history with real recorded states
 * ("Not recorded" when unknown), confirm before a resend, the provider's
 * answer after, and a refusal kept on screen.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AccountEmailsSection } from "@/components/v2/admin/accounts/person/account-emails-section";

afterEach(() => vi.unstubAllGlobals());

const overview = {
  email: "jane@example.invalid",
  invitation: { expiresAt: "2026-11-19T00:00:00.000Z", acceptedAt: null, expired: false },
  options: [
    { type: "INVITATION", label: "Resend invitation", allowed: true, reason: null },
    { type: "PASSWORD_RESET", label: "Send password reset link", allowed: false, reason: "Resend the invitation instead." },
    { type: "SIGNUP_CODE", label: "Resend sign-up code", allowed: false, reason: "Resend the invitation instead." },
  ],
  canCopyInvitationLink: true,
  history: [{ id: "h1", label: "Client portal access (temporary password)", at: "2026-11-01T00:00:00.000Z", to: "jane@example.invalid", state: "NOT_RECORDED", stateLabel: "Not recorded", sentBy: "Ada", note: null }],
  coolDownMinutes: 5,
};

describe("AccountEmailsSection", () => {
  it("lists what was sent, confirms a resend and shows the provider's answer", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ type: "INVITATION", to: "jane@example.invalid", state: "ACCEPTED", stateLabel: "Accepted by the email provider (delivery not confirmed)", error: null }), { status: 200 });
      return new Response(JSON.stringify(overview), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountEmailsSection userId="p1" />);
    const section = await screen.findByRole("region", { name: "Account emails" });
    expect(await within(section).findByText("Client portal access (temporary password)")).toBeInTheDocument();
    expect(within(section).getAllByText("Not recorded").length).toBeGreaterThan(0);
    expect(within(section).queryByRole("button", { name: "Send password reset link" })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: "Resend invitation" }));
    const confirm = within(section).getByRole("group", { name: "Confirm Resend invitation" });
    expect(confirm).toHaveTextContent("jane@example.invalid");
    expect(confirm).toHaveTextContent("The previous invitation link stops working.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Resend invitation" }));
    expect(await within(section).findByText(/delivery not confirmed/)).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(postCall[0]).toBe("/api/admin/users/p1/account-emails");
    expect(JSON.parse(String(postCall[1]!.body))).toEqual({ type: "INVITATION" });
  });

  it("keeps a refusal on screen", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST"
      ? new Response(JSON.stringify({ error: "Invitation to set a password was sent less than 5 minutes ago. Try again in 4 minutes." }), { status: 429 })
      : new Response(JSON.stringify(overview), { status: 200 }))));
    render(<AccountEmailsSection userId="p1" />);
    const section = await screen.findByRole("region", { name: "Account emails" });
    fireEvent.click(await within(section).findByRole("button", { name: "Resend invitation" }));
    fireEvent.click(within(within(section).getByRole("group")).getByRole("button", { name: "Resend invitation" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent("Try again in 4 minutes");
  });
});
