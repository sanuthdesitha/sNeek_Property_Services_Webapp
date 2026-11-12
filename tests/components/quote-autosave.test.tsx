/**
 * Quote full page autosave and office notes (owner decision 2026-11-13; the
 * invoice editor's Wave D design): debounced, serialised (newest wins), never
 * while a field is invalid, never on a converted or new quote, never changing
 * the status; Saving… / Saved N seconds ago / Not saved with Retry; the
 * conflict banner (Reload theirs / Keep my edits and retry); primary actions
 * wait until saved; the leave-page warning only while something is unsaved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/v2/admin/onboarding/address-input", () => ({
  EAddressInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <input aria-label="Service address input" value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { QuoteFullPage } from "@/components/v2/admin/quotes/full/quote-full-page";
import { QuoteBuilder } from "@/components/v2/admin/quotes/quote-builder";
import { snapshotFromRecord } from "@/lib/quotes/quote-record";

const T0 = "2026-11-13T01:00:00.000Z";
const T1 = "2026-11-13T01:00:05.000Z";
const T2 = "2026-11-13T01:00:09.000Z";
const T9 = "2026-11-13T01:09:00.000Z";

type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
type Reply = { status?: number; body: unknown };
type Responder = (call: Call) => Reply | Promise<Reply>;

let calls: Call[] = [];
let onPatch: Responder;
let onDiscount: Responder;
let onGet: Responder;

function record(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "quote-000230",
    quoteNumber: 230,
    status,
    serviceType: "DEEP_CLEAN",
    subtotal: 480,
    gstAmount: 48,
    totalAmount: 528,
    notes: 'Deep clean.\n[[META:{"extras":[],"quoteHeading":"Oven and window deep clean","pricingSource":"rate-card"}]]',
    internalNotes: "Gate code 4411",
    validUntil: "2026-11-23T12:59:59.000Z",
    createdAt: "2026-11-09T03:48:00.000Z",
    updatedAt: T0,
    clientId: "c1",
    client: { id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au" },
    publicToken: status === "DRAFT" ? null : "tok",
    lineItems: [{ label: "Deep clean, 2 bed 1 bath", unitPrice: 480, qty: 1, total: 480 }],
    requestedAddOns: [],
    ...extra,
  };
}

const options = {
  leads: [],
  clients: [{ id: "c1", name: "Harbour View Stays", email: "accounts@harbourview.com.au", suburb: "Coogee" }],
  services: [{ jobType: "DEEP_CLEAN", label: "Deep clean", model: "HOURLY" as const, itemLabel: null, unitLabel: null, bands: [] }],
  gstEnabled: true,
  pricingVariables: [],
};

function renderPage(status: string, extra: Record<string, unknown> = {}) {
  return render(<QuoteFullPage initial={snapshotFromRecord(record(status, extra))} builderOptions={options} marginModel={{ costShare: 0.55, floorPercent: 40 }} timezone="Australia/Sydney" fromCase={null} />);
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function patches(): Call[] {
  return calls.filter((call) => call.method === "PATCH");
}

function officeNotes(): HTMLTextAreaElement {
  return screen.getByLabelText(/Office notes \(not shown to the client\)/) as HTMLTextAreaElement;
}

/** What the PATCH answers: the stored row after the write (status unchanged). */
function saved(call: Call, updatedAt: string): Reply {
  const { expectedUpdatedAt: _token, ...written } = call.body ?? {};
  return { body: { id: "quote-000230", ...written, updatedAt } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  calls = [];
  push.mockReset();
  onPatch = (call) => saved(call, T1);
  onDiscount = () => ({ body: { ok: true, updatedAt: T2 } });
  onGet = () => ({ body: record("SENT", { updatedAt: T9, internalNotes: "Theirs: call before 9" }) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const call: Call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const reply = (r: Reply) => ({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body, blob: async () => new Blob() });
      if (url.startsWith("/api/admin/checklists")) return reply({ body: { checklist: null } });
      if (url.startsWith("/api/admin/properties")) return reply({ body: [] });
      if (url.includes("/events")) return reply({ body: { events: [] } });
      if (url.endsWith("/discount")) return reply(await onDiscount(call));
      if (url === "/api/admin/quotes/quote-000230" && method === "PATCH") return reply(await onPatch(call));
      if (url === "/api/admin/quotes/quote-000230") return reply(await onGet(call));
      return reply({ body: {} });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Quote page autosave", () => {
  it("saves 1.5 s after the last change, with the version token, and says when", async () => {
    renderPage("DRAFT");
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Ring first" } });
    await advance(1000);
    expect(patches()).toHaveLength(0);
    fireEvent.change(officeNotes(), { target: { value: "Ring first, then knock" } });
    await advance(1000);
    expect(patches()).toHaveLength(0);
    await advance(600);
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toMatchObject({ internalNotes: "Ring first, then knock", expectedUpdatedAt: T0 });
    expect(patches()[0].body).not.toHaveProperty("status");
    expect(screen.getAllByText(/Saved just now/).length).toBeGreaterThan(0);
    await advance(20_000);
    expect(screen.getAllByText(/Saved 20 seconds ago/).length).toBeGreaterThan(0);
    expect(patches()).toHaveLength(1);
  });

  it("runs one save at a time and then saves the newest draft with the new token", async () => {
    const first = deferred<Reply>();
    let n = 0;
    onPatch = (call) => (++n === 1 ? first.promise : saved(call, T2));
    renderPage("DRAFT");
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "A" } });
    await advance(1600);
    expect(patches()).toHaveLength(1);
    expect(screen.getAllByText("Saving…").length).toBeGreaterThan(0);
    // Typing stays usable during a background save.
    expect(officeNotes().closest("fieldset")?.disabled).toBe(false);
    fireEvent.change(officeNotes(), { target: { value: "AB" } });
    await advance(5000);
    expect(patches()).toHaveLength(1);
    await act(async () => {
      first.resolve({ body: { id: "quote-000230", internalNotes: "A", updatedAt: T1 } });
      await vi.advanceTimersByTimeAsync(0);
    });
    await advance(1600);
    expect(patches()).toHaveLength(2);
    expect(patches()[1].body).toMatchObject({ internalNotes: "AB", expectedUpdatedAt: T1 });
  });

  it("never saves while a field is invalid and says why", async () => {
    renderPage("DRAFT");
    await advance(0);
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "  " } });
    await advance(5000);
    expect(patches()).toHaveLength(0);
    expect(screen.getAllByText(/Not saved yet: Line 1 needs a description and a price/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Line 1 description"), { target: { value: "Deep clean" } });
    await advance(1600);
    expect(patches()).toHaveLength(1);
  });

  it("keeps my edits on a conflict and retries them on the version it re-reads", async () => {
    onPatch = (call) =>
      call.body?.expectedUpdatedAt === T0
        ? { status: 409, body: { error: "This quote was changed somewhere else since you opened it.", code: "STALE_QUOTE", currentUpdatedAt: T9 } }
        : saved(call, T2);
    renderPage("DRAFT");
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Mine" } });
    await advance(1600);
    const banner = screen.getByRole("alert");
    expect(banner.textContent).toMatch(/not saved\..*changed somewhere else.*Your edits are still here/);
    expect(officeNotes().value).toBe("Mine");
    expect(screen.getAllByText("Not saved: changed elsewhere").length).toBeGreaterThan(0);
    // A conflict stops autosave until the person chooses.
    await advance(5000);
    expect(patches()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits and retry" }));
    await advance(0);
    expect(calls.some((call) => call.method === "GET" && call.url === "/api/admin/quotes/quote-000230")).toBe(true);
    expect(patches()).toHaveLength(2);
    expect(patches()[1].body).toMatchObject({ internalNotes: "Mine", expectedUpdatedAt: T9 });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Reload theirs replaces my draft with the stored version", async () => {
    onPatch = () => ({ status: 409, body: { error: "Changed elsewhere.", code: "STALE_QUOTE", currentUpdatedAt: T9 } });
    renderPage("DRAFT");
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Mine" } });
    await advance(1600);
    fireEvent.click(screen.getByRole("button", { name: "Reload theirs" }));
    await advance(0);
    expect(officeNotes().value).toBe("Theirs: call before 9");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not repeat a failed save until Retry, then sends it again", async () => {
    let n = 0;
    onPatch = (call) => (++n === 1 ? { status: 500, body: { error: "Database unavailable" } } : saved(call, T1));
    renderPage("DRAFT");
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Ring first" } });
    await advance(1600);
    expect(screen.getByRole("alert").textContent).toMatch(/not saved\. Database unavailable/);
    expect(screen.getAllByText("Not saved").length).toBeGreaterThan(0);
    await advance(10_000);
    expect(patches()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advance(0);
    expect(patches()).toHaveLength(2);
    expect(screen.getAllByText(/Saved just now/).length).toBeGreaterThan(0);
  });

  it("re-applies a stored discount after the save and adopts the discount's version token", async () => {
    renderPage("DRAFT", {
      lineItems: [
        { label: "Deep clean, 2 bed 1 bath", unitPrice: 480, qty: 1, total: 480 },
        { label: "Discount · Welcome (WELCOME10)", unitPrice: -48, qty: 1, total: -48 },
      ],
      discountCode: "WELCOME10",
    });
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "One" } });
    await advance(1600);
    expect(calls.filter((call) => call.url.endsWith("/discount")).map((call) => call.body)).toEqual([{ code: "WELCOME10" }]);
    fireEvent.change(officeNotes(), { target: { value: "Two" } });
    await advance(1600);
    expect(patches()[1].body).toMatchObject({ internalNotes: "Two", expectedUpdatedAt: T2 });
  });

  it("does not autosave a converted quote (explicit Save, with the token)", async () => {
    renderPage("CONVERTED", { convertedJobId: "job-1066" });
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Paid by card on site" } });
    await advance(5000);
    expect(patches()).toHaveLength(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
    await advance(0);
    expect(patches()).toHaveLength(1);
    expect(patches()[0].body).toMatchObject({ internalNotes: "Paid by card on site", expectedUpdatedAt: T0, status: "CONVERTED" });
  });

  it("does not autosave on New quote until Create draft", async () => {
    render(<QuoteBuilder {...options} recipientPrefill={{ clientId: "c1" }} />);
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Referred by Harbour View" } });
    await advance(5000);
    expect(calls.filter((call) => call.url.startsWith("/api/admin/quotes") && call.method !== "GET")).toHaveLength(0);
  });

  it("never changes the status on its own: the status select waits for Save", async () => {
    renderPage("SENT");
    await advance(0);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "DECLINED" } });
    await advance(5000);
    expect(patches()).toHaveLength(0);
    expect(screen.getAllByText(/Unsaved changes/).length).toBeGreaterThan(0);
  });

  it("saves the draft first, then sends Mark won with the token that save produced", async () => {
    renderPage("SENT");
    await advance(0);
    fireEvent.change(officeNotes(), { target: { value: "Won on the phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark won" }));
    await advance(0);
    expect(patches().map((call) => call.body)).toEqual([
      expect.objectContaining({ internalNotes: "Won on the phone", expectedUpdatedAt: T0 }),
      { status: "ACCEPTED", expectedUpdatedAt: T1 },
    ]);
  });

  it("tells the office that a shared quote's online page changes as soon as it saves", () => {
    renderPage("SENT");
    expect(screen.getByText(/The client can already open this quote online/)).toBeTruthy();
    cleanup();
    renderPage("DRAFT");
    expect(screen.queryByText(/The client can already open this quote online/)).toBeNull();
  });

  it("warns before leaving only while something is unsaved", async () => {
    renderPage("DRAFT");
    await advance(0);
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    fireEvent.change(officeNotes(), { target: { value: "Ring first" } });
    expect(leave()).toBe(true);
    await advance(1600);
    expect(leave()).toBe(false);
  });
});
