import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanerLocalDraftKey, readCleanerLocalDraft, writeCleanerLocalDraft, clearCleanerLocalDraft, hasLegacyCleanerLocalDraft } from "@/lib/cleaner/local-draft";

const a = "a".repeat(64), b = "b".repeat(64);
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("actor-scoped cleaner local recovery", () => {
  it("reads and clears only the exact identity", () => {
    expect(writeCleanerLocalDraft(a, { answers: { note: "A" } })).toBe(true);
    expect(readCleanerLocalDraft(b)).toEqual({ status: "empty" });
    expect(writeCleanerLocalDraft(b, { answers: { note: "B" } })).toBe(true);
    expect(readCleanerLocalDraft(a)).toEqual({ status: "ready", state: { answers: { note: "A" } } });
    expect(clearCleanerLocalDraft(a)).toBe(true);
    expect(readCleanerLocalDraft(a)).toEqual({ status: "empty" });
    expect(readCleanerLocalDraft(b)).toEqual({ status: "ready", state: { answers: { note: "B" } } });
  });
  it.each(["{", "null", "[]", "{}", JSON.stringify({ version: 1, identity: b, state: {} }), JSON.stringify({ version: 1, identity: a, state: [] })])("preserves malformed or misplaced record %s", raw => {
    localStorage.setItem(cleanerLocalDraftKey(a), raw);
    expect(readCleanerLocalDraft(a)).toEqual({ status: "invalid" });
    expect(writeCleanerLocalDraft(a, {})).toBe(false);
    expect(clearCleanerLocalDraft(a)).toBe(false);
    expect(localStorage.getItem(cleanerLocalDraftKey(a))).toBe(raw);
  });
  it("does not migrate or clear legacy job-only data", () => {
    const legacy = "cleaner-job-draft-v2:job";
    localStorage.setItem(legacy, JSON.stringify({ answers: { private: "old actor" } }));
    expect(hasLegacyCleanerLocalDraft("job")).toBe(true);
    expect(readCleanerLocalDraft(a)).toEqual({ status: "empty" });
    writeCleanerLocalDraft(a, {}); clearCleanerLocalDraft(a);
    expect(localStorage.getItem(legacy)).toContain("old actor");
  });
  it("reports unavailable reads without attempting a write", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(readCleanerLocalDraft(a)).toEqual({ status: "unavailable" });
    expect(writeCleanerLocalDraft(a, {})).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it("reports quota failure without replacing the previous snapshot", () => {
    writeCleanerLocalDraft(a, { previous: true });
    const raw = localStorage.getItem(cleanerLocalDraftKey(a));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(writeCleanerLocalDraft(a, { newer: true })).toBe(false);
    expect(localStorage.getItem(cleanerLocalDraftKey(a))).toBe(raw);
  });
  it("rejects invalid scopes and unserializable states", () => {
    expect(writeCleanerLocalDraft("", {})).toBe(false);
    expect(readCleanerLocalDraft("../other")).toEqual({ status: "invalid" });
    expect(clearCleanerLocalDraft("bad")).toBe(false);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(writeCleanerLocalDraft(a, circular)).toBe(false);
  });
});
