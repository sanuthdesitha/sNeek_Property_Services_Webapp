import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientApprovalsBoard } from "@/components/v2/client/approvals-board";
import { EstateMessagesThread } from "@/components/v2/client/messages-thread";
import type { QuoteWaiting } from "@/components/v2/client/approvals/quote-decision-card";

const mocks = vi.hoisted(() => ({ session: vi.fn(), fetch: vi.fn() }));
vi.mock("next-auth/react", () => ({ useSession: mocks.session }));

const CONTEXT = "c".repeat(64);
const extra = {
  version: "a".repeat(64), id: "extra-1", title: "Inside oven, trays and racks", description: "Photo attached",
  amount: 45, currency: "AUD", status: "PENDING", requestedAt: "2026-11-10T01:00:00Z", expiresAt: null,
  responseNote: null, property: { name: "Coogee Terrace", suburb: "Coogee" }, job: null,
};
const quote = (extraFields: Partial<QuoteWaiting> = {}): QuoteWaiting => ({
  id: "quote-1", serviceType: "END_OF_LEASE", totalAmount: 640, validUntil: "2099-11-26T00:00:00Z",
  createdAt: "2026-11-01T00:00:00Z", expired: false, ...extraFields,
});
const json = (body: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) => ({
  ok: init.ok ?? true, status: init.status ?? 200, json: async () => body,
  headers: { get: (name: string) => init.headers?.[name] ?? null },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.session.mockReturnValue({ status: "authenticated", data: { user: { id: "client-1", role: "CLIENT" } } });
});
afterEach(() => vi.unstubAllGlobals());

describe("Approvals lists quotes waiting for a decision", () => {
  it("counts extras and quotes together and links quotes into the existing decision flow", async () => {
    mocks.fetch.mockResolvedValueOnce(json([extra]));
    render(<ClientApprovalsBoard quotes={[quote()]} />);
    await screen.findByText("Inside oven, trays and racks");
    const segments = screen.getByRole("navigation", { name: "Approval views" });
    expect(within(segments).getByRole("link", { name: /Waiting\s*2/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Approve $45.00" })).toBeEnabled();
    expect(screen.getByText("End of lease quote")).toBeVisible();
    expect(screen.getByRole("link", { name: "Accept" })).toHaveAttribute("href", "/v2/client/quotes?quote=quote-1&intent=accept#quote-quote-1");
    expect(screen.getByRole("link", { name: "Decline" })).toHaveAttribute("href", "/v2/client/quotes?quote=quote-1&intent=decline#quote-quote-1");
    expect(screen.getByRole("link", { name: "Ask for change" })).toHaveAttribute("href", "/v2/client/quotes?quote=quote-1&intent=change#quote-quote-1");
    // Quotes are never decided from Approvals: only the approvals GET was called.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not offer Accept on an expired quote", async () => {
    mocks.fetch.mockResolvedValueOnce(json([]));
    render(<ClientApprovalsBoard quotes={[quote({ expired: true, validUntil: "2026-10-01T00:00:00Z" })]} />);
    await screen.findByText("End of lease quote");
    expect(screen.queryByRole("link", { name: "Accept" })).toBeNull();
    expect(screen.getByText(/Expired 1 Oct · ask us for an updated quote/)).toBeVisible();
    expect(screen.queryByText("All clear")).toBeNull();
  });

  it("never reports all clear while quotes could not be read", async () => {
    mocks.fetch.mockResolvedValueOnce(json([]));
    render(<ClientApprovalsBoard quotes={null} />);
    await screen.findByText(/Quotes waiting for a decision could not be loaded/);
    expect(screen.queryByText("All clear")).toBeNull();
    expect(screen.getByText("Waiting count unverified.")).toBeVisible();
  });

  it("shows decided requests on the History segment only", async () => {
    mocks.fetch.mockResolvedValueOnce(json([extra, { ...extra, id: "old", title: "Balcony wash", status: "DECLINED", responseNote: "Not now" }]));
    const view = render(<ClientApprovalsBoard view="history" quotes={[]} />);
    await screen.findByText("Balcony wash");
    expect(screen.queryByText("Inside oven, trays and racks")).toBeNull();
    expect(screen.getByText("“Not now”")).toBeVisible();
    view.rerender(<ClientApprovalsBoard view="waiting" quotes={[]} />);
    expect(screen.getByText("Inside oven, trays and racks")).toBeVisible();
    expect(screen.queryByText("Balcony wash")).toBeNull();
  });
});

describe("Messages saved and retry states", () => {
  it("keeps an unconfirmed message for a retry with the SAME request id, then shows it saved", async () => {
    const own = { id: "m1", body: "Also check the balcony light?", isFromAdmin: false, createdAt: "2026-11-12T00:15:00Z", jobId: null, sentBy: { id: "client-1", name: "Alex", role: "CLIENT" } };
    mocks.fetch
      .mockResolvedValueOnce(json([], { headers: { "X-Client-Message-Context": CONTEXT } }))
      .mockRejectedValueOnce(new Error("network"));
    render(<EstateMessagesThread />);
    const box = await screen.findByRole("textbox", { name: "Message the team" });
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.change(box, { target: { value: own.body } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Not confirmed.");
    // Composer is frozen while a receipt is pending; nothing is lost.
    expect(screen.getByRole("textbox", { name: "Message the team" })).toBeDisabled();
    const first = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    mocks.fetch.mockResolvedValueOnce(json({ ...own, requestId: first.requestId }, { status: 201, headers: { "X-Client-Message-Context": CONTEXT } }));
    await act(async () => { fireEvent.click(within(alert).getByRole("button", { name: "Retry the same message" })); });
    const retry = JSON.parse(mocks.fetch.mock.calls[2][1].body);
    expect(retry).toEqual({ body: own.body, requestId: first.requestId });
    expect(mocks.fetch.mock.calls[2][1].headers["X-Client-Message-Context"]).toBe(CONTEXT);
    expect(await screen.findByText(/^Saved \d{2}:\d{2}$/)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message the team" })).toHaveValue("");
  });

  it("does not call a receipt for another request saved", async () => {
    mocks.fetch
      .mockResolvedValueOnce(json([], { headers: { "X-Client-Message-Context": CONTEXT } }))
      .mockResolvedValueOnce(json({ id: "x", body: "Hello", isFromAdmin: false, createdAt: "2026-11-12T00:15:00Z", sentBy: { id: "client-1", name: null, role: "CLIENT" }, requestId: "00000000-0000-4000-8000-000000000000" }, { status: 201, headers: { "X-Client-Message-Context": CONTEXT } }));
    render(<EstateMessagesThread />);
    const box = await screen.findByRole("textbox", { name: "Message the team" });
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.change(box, { target: { value: "Hello" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send" })); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Not confirmed.");
    expect(screen.queryByText(/^Saved/)).toBeNull();
  });
});
