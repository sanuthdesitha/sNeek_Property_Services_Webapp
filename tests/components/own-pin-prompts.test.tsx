/**
 * Own PIN prompts (owner decision 2026-11-13):
 *  - the Rate card / Price book lock asks for "Your PIN", remembers an unlock
 *    for that signed-in person only, and walks someone with no PIN through
 *    "password once + new PIN";
 *  - the Decided tab offers Delete record only to an administrator.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EstatePageLock } from "@/components/v2/admin/pricing/estate-page-lock";
import { ApprovalsHistory } from "@/components/v2/admin/approvals/approvals-history";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let pinState: { hasPin: boolean; lockedUntil: string | null; userId: string } = { hasPin: true, lockedUntil: null, userId: "ops-1" };
let verifyAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } };
let historyBody: unknown = { items: [], nextCursor: null };

beforeEach(() => {
  calls = [];
  pinState = { hasPin: true, lockedUntil: null, userId: "ops-1" };
  verifyAnswer = { status: 200, body: { ok: true } };
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/me/admin-pin") return new Response(JSON.stringify(pinState));
    if (url === "/api/admin/security/verify") return new Response(JSON.stringify(verifyAnswer.body), { status: verifyAnswer.status });
    if (url.startsWith("/api/admin/approvals/history")) return new Response(JSON.stringify(historyBody));
    return new Response("{}");
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Rate card lock", () => {
  it("unlocks with the person's own PIN and remembers it for that person only", async () => {
    const view = render(<EstatePageLock lockId="pricing" title="Rate card is locked"><p>Rates editor</p></EstatePageLock>);
    fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "4826" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Rates editor")).toBeVisible();
    expect(JSON.parse(String(calls.find((call) => call.url === "/api/admin/security/verify")?.init?.body))).toEqual({ pin: "4826" });
    expect(sessionStorage.getItem("sneek_pagelock_pricing:ops-1")).toBe("1");
    view.unmount();

    // Another person signing in on the same tab starts locked.
    pinState = { hasPin: true, lockedUntil: null, userId: "admin-2" };
    render(<EstatePageLock lockId="pricing" title="Rate card is locked"><p>Rates editor</p></EstatePageLock>);
    expect(await screen.findByLabelText("Your PIN")).toBeVisible();
    await waitFor(() => expect(calls.filter((call) => call.url === "/api/me/admin-pin")).toHaveLength(2));
    expect(screen.queryByText("Rates editor")).toBeNull();
  });

  // Changed 2026-11-14 (owner default, pending confirmation): the password alone confirms while there is no PIN.
  it("asks someone with no PIN for their password alone and links to Set a PIN", async () => {
    pinState = { hasPin: false, lockedUntil: null, userId: "ops-1" };
    render(<EstatePageLock lockId="pricing"><p>Rates editor</p></EstatePageLock>);
    fireEvent.change(await screen.findByLabelText("Your password"), { target: { value: "correct horse" } });
    expect(screen.getByRole("link", { name: "Set a PIN" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Rates editor")).toBeVisible();
    expect(JSON.parse(String(calls.find((call) => call.url === "/api/admin/security/verify")?.init?.body))).toEqual({ password: "correct horse" });
  });

  it("shows the server's reason and stays locked when the PIN is refused", async () => {
    verifyAnswer = { status: 403, body: { ok: false, code: "ACTUAL_ACTOR_REQUIRED", error: "Sensitive actions cannot be confirmed while testing as someone else. Stop testing first." } };
    render(<EstatePageLock lockId="pricing"><p>Rates editor</p></EstatePageLock>);
    fireEvent.change(await screen.findByLabelText("Your PIN"), { target: { value: "4826" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/while testing as someone else/);
    expect(screen.queryByText("Rates editor")).toBeNull();
  });
});

describe("Decided tab: Delete record", () => {
  const item = {
    id: "h1", createdAt: "2026-11-12T01:00:00Z", queue: "payAdjustments", decision: "APPROVED", entityId: "p1", label: "Parking", amount: 12, value: null,
    note: null, subjectName: "Marco", decidedBy: { id: "a", name: "Ada", email: "a@x", role: "ADMIN" }, href: null, currentAmount: 12, settled: false,
    capabilities: { canEdit: true, canUndo: true, canDelete: true, reasons: {} },
  };

  it.each([
    [true, true],
    [false, false],
  ])("administrator=%s sees Delete record: %s", async (admin, shown) => {
    historyBody = { items: [item], nextCursor: null, canDeleteRecords: admin };
    render(<ApprovalsHistory />);
    fireEvent.click(await screen.findByRole("button", { name: /More actions for Parking/ }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Delete record" }) !== null).toBe(shown);
    expect(within(menu).getByRole("menuitem", { name: "Reverse decision" })).toBeInTheDocument();
  });
});
