import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  clearRestorable,
  clearRestorablePath,
  mergeRestorable,
  readRestorable,
  writeRestorable,
} from "@/lib/client/restorable-state";

/**
 * "Back as rewind": leaving a list and returning should give it back as it was.
 *
 * The failure modes that matter are not the happy path. sessionStorage throws
 * in private-mode Safari and when the quota is full, and a stored value written
 * by an older deploy can be missing keys the page now expects — none of which
 * is worth breaking a page over.
 */
describe("restorable state", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a value for a pathname", () => {
    writeRestorable("/v2/admin/jobs", "filters", { status: "OPEN" });
    expect(readRestorable("/v2/admin/jobs", "filters")).toEqual({ status: "OPEN" });
  });

  it("keeps pages separate", () => {
    // Two pages both tracking "filters" must not read each other's.
    writeRestorable("/v2/admin/jobs", "filters", { status: "OPEN" });
    writeRestorable("/v2/admin/cases", "filters", { status: "CLOSED" });
    expect(readRestorable("/v2/admin/jobs", "filters")).toEqual({ status: "OPEN" });
    expect(readRestorable("/v2/admin/cases", "filters")).toEqual({ status: "CLOSED" });
  });

  it("returns undefined for something never stored", () => {
    expect(readRestorable("/v2/admin/jobs", "filters")).toBeUndefined();
  });

  it("returns undefined for corrupt JSON rather than throwing", () => {
    window.sessionStorage.setItem("sneek:page-state:/p:k", "{not json");
    expect(readRestorable("/p", "k")).toBeUndefined();
  });

  it("survives a storage that throws on write", () => {
    // Private-mode Safari. Losing a filter must not take the page down.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeRestorable("/p", "k", { a: 1 })).not.toThrow();
  });

  it("survives a storage that throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readRestorable("/p", "k")).toBeUndefined();
  });

  it("clears one key without touching its neighbours", () => {
    writeRestorable("/p", "a", 1);
    writeRestorable("/p", "b", 2);
    clearRestorable("/p", "a");
    expect(readRestorable("/p", "a")).toBeUndefined();
    expect(readRestorable("/p", "b")).toBe(2);
  });

  it("clears a whole path for a reset control", () => {
    writeRestorable("/p", "a", 1);
    writeRestorable("/p", "b", 2);
    writeRestorable("/other", "a", 3);
    clearRestorablePath("/p");
    expect(readRestorable("/p", "a")).toBeUndefined();
    expect(readRestorable("/p", "b")).toBeUndefined();
    // A reset on one page must not wipe another's.
    expect(readRestorable("/other", "a")).toBe(3);
  });

  it("clears every key on the path, not every other one", () => {
    // Removing while walking the store shifts the indices, which silently
    // skips half the keys.
    for (let i = 0; i < 8; i++) writeRestorable("/p", `k${i}`, i);
    clearRestorablePath("/p");
    for (let i = 0; i < 8; i++) expect(readRestorable("/p", `k${i}`)).toBeUndefined();
  });
});

describe("mergeRestorable", () => {
  it("gives a newly added filter its default instead of undefined", () => {
    // A stored object from an older deploy has no `cleanerId`; reaching a
    // <select> as undefined would make it uncontrolled.
    const merged = mergeRestorable({ status: "all", cleanerId: "all" }, { status: "OPEN" });
    expect(merged).toEqual({ status: "OPEN", cleanerId: "all" });
  });

  it("falls back to the initial value when the stored type is wrong", () => {
    expect(mergeRestorable("list", 42)).toBe("list");
    expect(mergeRestorable({ a: 1 }, "nonsense")).toEqual({ a: 1 });
  });

  it("replaces primitives and arrays wholesale", () => {
    expect(mergeRestorable("list", "board")).toBe("board");
    expect(mergeRestorable([1, 2], [3])).toEqual([3]);
  });

  it("keeps the initial value for null or undefined", () => {
    expect(mergeRestorable({ a: 1 }, null)).toEqual({ a: 1 });
    expect(mergeRestorable({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});
