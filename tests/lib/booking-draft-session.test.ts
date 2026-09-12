import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BookingDraft, loadBookingDraft, removeBookingDraft, saveBookingDraft } from "@/lib/booking/draft-session";

const scope = "a".repeat(64);
const otherScope = "b".repeat(64);
const key = (value = scope) => `sneek:booking-draft:v1:${value}`;
const draft: BookingDraft = {
  propertyId: "property-1", jobType: "GENERAL_CLEAN", scheduledDate: "2028-02-29",
  notes: "  Side entrance\nPlease knock  ", step: 3,
};
const request = {
  key: "123e4567-e89b-42d3-a456-426614174000",
  payload: JSON.stringify({
    propertyId: draft.propertyId, jobType: draft.jobType,
    scheduledDate: draft.scheduledDate, notes: draft.notes,
  }),
};
const envelope = (value: unknown = draft) => ({ version: 1, scope, draft: value });

beforeEach(() => { window.sessionStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("booking draft session", () => {
  it("does not access storage at import or write during reads", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    vi.resetModules();
    const reloaded = await import("@/lib/booking/draft-session");
    expect(get).not.toHaveBeenCalled();
    expect(reloaded.loadBookingDraft(scope)).toEqual({ status: "empty" });
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("saves a versioned scoped envelope and recovers after module reload", async () => {
    const value = { ...draft, request, confirmedRequestId: "request-1" };
    expect(saveBookingDraft(scope, value)).toBe(true);
    expect(JSON.parse(window.sessionStorage.getItem(key())!)).toEqual(envelope(value));
    vi.resetModules();
    const reloaded = await import("@/lib/booking/draft-session");
    expect(reloaded.loadBookingDraft(scope)).toEqual({ status: "ready", draft: value });
  });

  it("supports incomplete drafts and every step", () => {
    for (const step of [1, 2, 3] as const) {
      const value = { propertyId: "", jobType: "", scheduledDate: "", notes: "", step };
      expect(saveBookingDraft(scope, value)).toBe(true);
      expect(loadBookingDraft(scope)).toEqual({ status: "ready", draft: value });
    }
  });

  it("isolates scopes and removes only the requested draft, including absent drafts", () => {
    expect(saveBookingDraft(scope, draft)).toBe(true);
    expect(loadBookingDraft(otherScope)).toEqual({ status: "empty" });
    expect(saveBookingDraft(otherScope, { ...draft, notes: "Other" })).toBe(true);
    expect(removeBookingDraft(scope)).toBe(true);
    expect(removeBookingDraft(scope)).toBe(true);
    expect(loadBookingDraft(scope)).toEqual({ status: "empty" });
    expect(loadBookingDraft(otherScope).draft?.notes).toBe("Other");
  });

  it("never falls back to localStorage or another tab's storage", () => {
    window.localStorage.setItem(key(), JSON.stringify(envelope()));
    expect(loadBookingDraft(scope)).toEqual({ status: "empty" });
    window.localStorage.removeItem(key());
    expect(saveBookingDraft(scope, draft)).toBe(true);
    vi.spyOn(window, "sessionStorage", "get").mockReturnValue({ getItem: () => null } as unknown as Storage);
    expect(loadBookingDraft(scope)).toEqual({ status: "empty" });
  });

  it.each(["", "a".repeat(63), "a".repeat(65), "g".repeat(64), "../client", null, 123])(
    "rejects invalid scope %s without accessing storage", (value) => {
      const getter = vi.spyOn(window, "sessionStorage", "get");
      expect(loadBookingDraft(value as string)).toEqual({ status: "invalid" });
      expect(saveBookingDraft(value as string, draft)).toBe(false);
      expect(removeBookingDraft(value as string)).toBe(false);
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it("accepts uppercase hex without changing the caller's scope", () => {
    const upper = scope.toUpperCase();
    expect(saveBookingDraft(upper, draft)).toBe(true);
    expect(loadBookingDraft(upper)).toEqual({ status: "ready", draft });
    expect(loadBookingDraft(scope)).toEqual({ status: "empty" });
  });

  it.each(["", "{", "null", "[]", "true", JSON.stringify(draft),
    JSON.stringify({ ...envelope(), version: 2 }),
    JSON.stringify({ ...envelope(), version: "1" }),
    JSON.stringify({ ...envelope(), scope: otherScope }),
    JSON.stringify({ ...envelope(), extra: true }),
    JSON.stringify({ version: 1, scope }),
  ])("rejects malformed, unsupported or foreign envelopes without changing storage (%#)", (raw) => {
    window.sessionStorage.setItem(key(), raw);
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    expect(loadBookingDraft(scope)).toEqual({ status: "invalid" });
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(key())).toBe(raw);
  });

  const invalidDrafts: unknown[] = [
    null, [], {}, { ...draft, extra: true }, { ...draft, notes: null },
    ...[0, 4, "1", 1.5].map((step) => ({ ...draft, step })),
    ...["2027-02-29", "1900-02-29", "2026-04-31", "2026-00-10", "2026-13-01",
      "2026-01-00", "2026-1-01", "not-a-date", "2026-01-01T00:00:00Z"].map((scheduledDate) => ({ ...draft, scheduledDate })),
    { ...draft, propertyId: "x".repeat(201) }, { ...draft, jobType: "x".repeat(101) },
    { ...draft, notes: "x".repeat(4001) }, { ...draft, confirmedRequestId: "orphan" },
    { ...draft, request, confirmedRequestId: "" },
    { ...draft, request, confirmedRequestId: "x".repeat(201) },
    { ...draft, request: { ...request, key: "not-a-uuid" } },
    { ...draft, request: { ...request, extra: true } },
    { ...draft, request: null },
    ...["{", "null", "[]", "{}", "x".repeat(10001),
      JSON.stringify({ ...JSON.parse(request.payload), extra: true }),
      JSON.stringify({ propertyId: draft.propertyId, jobType: draft.jobType, scheduledDate: draft.scheduledDate }),
      ...["propertyId", "jobType", "scheduledDate", "notes"].map((field) =>
        JSON.stringify({ ...JSON.parse(request.payload), [field]: field === "scheduledDate" ? "2028-03-01" : "changed" })),
      JSON.stringify({ ...JSON.parse(request.payload), notes: draft.notes.trim() }),
    ].map((payload) => ({ ...draft, request: { ...request, payload } })),
  ];

  it.each(invalidDrafts.map((value, index) => [index, value] as const))(
    "rejects invalid draft on both save and load (%s)", (_index, value) => {
      expect(saveBookingDraft(scope, draft)).toBe(true);
      expect(saveBookingDraft(scope, value as BookingDraft)).toBe(false);
      expect(loadBookingDraft(scope)).toEqual({ status: "ready", draft });
      window.sessionStorage.setItem(key(), JSON.stringify(envelope(value)));
      expect(loadBookingDraft(scope)).toEqual({ status: "invalid" });
    },
  );

  it("accepts exact length limits and preserves valid request JSON formatting", () => {
    const fields = { propertyId: "p".repeat(200), jobType: "j".repeat(100), scheduledDate: "2000-02-29", notes: "n".repeat(4000) };
    const payload = JSON.stringify(fields).padEnd(10000, " ");
    const value: BookingDraft = { ...fields, step: 3, request: { ...request, payload }, confirmedRequestId: "r".repeat(200) };
    expect(saveBookingDraft(scope, value)).toBe(true);
    expect(loadBookingDraft(scope)).toEqual({ status: "ready", draft: value });
  });

  it("reports denied storage access honestly", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    expect(loadBookingDraft(scope)).toEqual({ status: "unavailable" });
    expect(saveBookingDraft(scope, draft)).toBe(false);
    expect(removeBookingDraft(scope)).toBe(false);
  });

  it("is safe without a browser window", () => {
    vi.stubGlobal("window", undefined);
    expect(loadBookingDraft(scope)).toEqual({ status: "unavailable" });
    expect(saveBookingDraft(scope, draft)).toBe(false);
    expect(removeBookingDraft(scope)).toBe(false);
  });

  it("distinguishes get failures from missing or corrupt data", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(loadBookingDraft(scope)).toEqual({ status: "unavailable" });
  });

  it("reports failed writes and removals while retaining the previous draft", () => {
    expect(saveBookingDraft(scope, draft)).toBe(true);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    expect(saveBookingDraft(scope, { ...draft, notes: "replacement" })).toBe(false);
    expect(removeBookingDraft(scope)).toBe(false);
    expect(loadBookingDraft(scope)).toEqual({ status: "ready", draft });
  });
});
