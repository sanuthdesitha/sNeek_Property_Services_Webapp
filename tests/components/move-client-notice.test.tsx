/**
 * "Tell the client?" inside the move window (board "Everyday dialogs and
 * sheets", 2026-11). Owner default: yes for a date or time change, no for a
 * cleaner swap; the answer is explicit and travels with the save; email only,
 * through the existing reschedule and client communications routes.
 */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientNoticeChoice, clientNoticeScope, defaultTellClient } from "@/components/v2/admin/calendar/client-notice-choice";
import { useCalendarMove } from "@/components/v2/admin/calendar/use-calendar-move";
import type { CheckMoveResponse } from "@/lib/calendar/types";
import { calendarJob } from "../lib/calendar-fixtures";

const job = calendarJob({ id: "jane-job", propertyName: "Bondi Studio", cleaners: [{ id: "u1", name: "Jane C.", isPrimary: true }] });

function check(plan: CheckMoveResponse["plan"], extra: Partial<CheckMoveResponse> = {}): CheckMoveResponse {
  return { jobId: "jane-job", propertyName: "Bondi Studio", fromDate: "2026-11-11", toDate: "2026-11-13", toCleanerName: null, blockers: [], warnings: [], plan, ...extra };
}
const dateMove = check({ reschedule: { date: "2026-11-13", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }, assign: null });
const swap = check({ reschedule: null, assign: { userIds: ["u2"], primaryUserId: "u2" } }, { toDate: "2026-11-11", toCleanerName: "Aiko T." });
const keepBoth = check({ reschedule: null, assign: { userIds: ["u1", "u2"], primaryUserId: "u1" } }, { toDate: "2026-11-11", toCleanerName: "Aiko T." });

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[];
let reply: (url: string) => { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  reply = () => ({ status: 200, body: {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    const { status, body } = reply(url);
    return { ok: status < 400, status, json: async () => body };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("owner defaults", () => {
  it("is Yes for a date change, No for a cleaner swap, and not asked when nobody is replaced", () => {
    expect(defaultTellClient(clientNoticeScope(job, dateMove))).toBe(true);
    expect(defaultTellClient(clientNoticeScope(job, swap))).toBe(false);
    expect(clientNoticeScope(job, swap).cleanerSwap).toBe(true);
    const scope = clientNoticeScope(job, keepBoth);
    expect(scope.schedule || scope.cleanerSwap).toBe(false);
  });

  it("with no client email on file, Yes is off and says why", async () => {
    reply = () => ({ status: 200, body: { recipients: [], reason: "No client email on file." } });
    const onChange = vi.fn();
    render(<ClientNoticeChoice job={job} scope={clientNoticeScope(job, dateMove)} value onChange={onChange} disabled={false} />);
    await waitFor(() => expect(screen.getByText(/No client email on file. "Yes" is off./)).toBeVisible());
    expect(calls[0]).toEqual({ url: "/api/admin/clients/c1/communications/send", body: { mode: "preview", stage: "SCHEDULE_UPDATED", jobId: "jane-job" } });
    expect(screen.getByRole("radio", { name: /Yes, email Harbour/ })).toBeDisabled();
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("the answer is an explicit choice the person can change", async () => {
    reply = () => ({ status: 200, body: { recipients: ["host@x"] } });
    const onChange = vi.fn();
    render(<ClientNoticeChoice job={job} scope={clientNoticeScope(job, swap)} value={false} onChange={onChange} disabled={false} />);
    await waitFor(() => expect(screen.getByText("Email only, to host@x.")).toBeVisible());
    fireEvent.click(screen.getByRole("radio", { name: /Yes, email Harbour/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("the save carries the answer through the existing routes", () => {
  async function checked(response: CheckMoveResponse) {
    const hook = renderHook(() => useCalendarMove(vi.fn()));
    reply = (url) => url.includes("check-move") ? { status: 200, body: response } : { status: 200, body: {} };
    await act(async () => { await hook.result.current.request({ job, toDate: response.toDate, fromCleanerId: null, toCleanerId: null }); });
    return hook;
  }

  it("a date change answered No sends notifyClient false and reports that the client was not told", async () => {
    const hook = await checked(dateMove);
    reply = () => ({ status: 200, body: { id: "jane-job", clientNotice: { status: "skipped_by_choice" } } });
    await act(async () => { await hook.result.current.confirm(false); });
    expect(calls.at(-1)).toEqual({ url: "/api/admin/phase4/reschedule/jane-job/apply", body: expect.objectContaining({ notifyClient: false }) });
    expect(hook.result.current.state).toMatchObject({ phase: "done", message: "Bondi Studio saved. The client was not told about the new time." });
  });

  it("a cleaner swap answered Yes sends the prepared note unedited and opens no second pop-up", async () => {
    const hook = await checked(swap);
    reply = (url) => url.includes("/assign")
      ? { status: 200, body: { ok: true, reassignPreview: { clientId: "c1", jobId: "jane-job", cleanerName: "Aiko", recipients: ["host@x"], subject: "S", html: "<p>H</p>" } } }
      : { status: 200, body: { ok: true, recipients: ["host@x"] } };
    await act(async () => { await hook.result.current.confirm(true); });
    const send = calls.find((call) => call.url.endsWith("/communications/send"));
    expect(send?.body).toEqual({ mode: "send", stage: "CLEANER_REASSIGNED", jobId: "jane-job", extra: { cleanerName: "Aiko" } });
    expect(hook.result.current.reassignPreview).toBeNull();
    expect(hook.result.current.state).toMatchObject({ phase: "done", message: expect.stringContaining("Cleaner-change email handed to the email service for host@x.") });
  });

  it("a cleaner swap answered No sends nothing to the client", async () => {
    const hook = await checked(swap);
    reply = () => ({ status: 200, body: { ok: true, reassignPreview: { clientId: "c1", jobId: "jane-job", recipients: ["host@x"], subject: "S", html: "<p>H</p>" } } });
    await act(async () => { await hook.result.current.confirm(false); });
    expect(calls.some((call) => call.url.endsWith("/communications/send"))).toBe(false);
    expect(hook.result.current.reassignPreview).toBeNull();
  });

  it("without an answer the old behaviour stays: no notifyClient, editable note offered afterwards", async () => {
    const hook = await checked(swap);
    reply = () => ({ status: 200, body: { ok: true, reassignPreview: { clientId: "c1", jobId: "jane-job", recipients: ["host@x"], subject: "S", html: "<p>H</p>" } } });
    await act(async () => { await hook.result.current.confirm(); });
    expect(hook.result.current.reassignPreview).toMatchObject({ clientId: "c1" });
  });

  it("a slow check for an older draft never replaces the newer one", async () => {
    let release: (() => void) | null = null;
    const hook = renderHook(() => useCalendarMove(vi.fn()));
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      if (body.toDate === "2026-11-13") return new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => dateMove }); });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...dateMove, toDate: "2026-11-14" }) });
    }));
    void act(() => { void hook.result.current.request({ job, toDate: "2026-11-13", fromCleanerId: null, toCleanerId: null }); });
    await act(async () => { await hook.result.current.request({ job, toDate: "2026-11-14", fromCleanerId: null, toCleanerId: null }); });
    await act(async () => { release?.(); });
    expect(hook.result.current.state).toMatchObject({ phase: "confirm", request: { toDate: "2026-11-14" } });
  });
});
