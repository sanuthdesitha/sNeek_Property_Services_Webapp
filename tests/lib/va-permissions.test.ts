import { describe, it, expect } from "vitest";
import {
  VA_PERMISSION_KEYS,
  VA_FORBIDDEN_ACTIONS,
  parseVaPermissions,
  emptyVaPermissions,
  hasVaPermission,
  assertVaMayAct,
  parseVaPropertyScope,
} from "@/lib/va/permissions";

/**
 * Two properties matter here and neither is about convenience.
 *
 * A malformed grant must FAIL CLOSED. `permissions` is a Json column, so it can
 * be hand-edited, half-written by a bad deploy, or arrive from an older shape.
 * Every one of those must leave the VA with nothing, not with everything.
 *
 * Money actions must be unreachable. They are not "a permission we chose not to
 * tick" — no blob, however crafted, may switch one on.
 */

describe("parseVaPermissions — fails closed", () => {
  it("grants nothing for null, undefined or a non-object", () => {
    for (const bad of [null, undefined, 42, "bookings", true]) {
      expect(parseVaPermissions(bad)).toEqual(emptyVaPermissions());
    }
  });

  it("grants nothing for an array", () => {
    // An array of key names is a plausible older shape; it must not grant.
    expect(parseVaPermissions(["bookings", "reports"])).toEqual(emptyVaPermissions());
  });

  it("ignores unknown keys instead of carrying them through", () => {
    const parsed = parseVaPermissions({ bookings: true, nonsense: true });
    expect(parsed.bookings).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual([...VA_PERMISSION_KEYS].sort());
  });

  it("requires boolean true — truthy values do not grant", () => {
    // "false", "0" and 1 are all truthy in JS; a loose check would grant here.
    const parsed = parseVaPermissions({
      bookings: "true",
      reports: 1,
      damage: "false",
      messages: {},
    });
    expect(parsed.bookings).toBe(false);
    expect(parsed.reports).toBe(false);
    expect(parsed.damage).toBe(false);
    expect(parsed.messages).toBe(false);
  });

  it("returns a complete record, so no key reads as undefined", () => {
    const parsed = parseVaPermissions({ bookings: true });
    for (const key of VA_PERMISSION_KEYS) {
      expect(typeof parsed[key]).toBe("boolean");
    }
  });

  it("grants exactly what was set", () => {
    const parsed = parseVaPermissions({ bookings: true, invoicesView: true });
    expect(hasVaPermission(parsed, "bookings")).toBe(true);
    expect(hasVaPermission(parsed, "invoicesView")).toBe(true);
    expect(hasVaPermission(parsed, "maintenance")).toBe(false);
  });
});

describe("money actions are not delegable", () => {
  it("blocks every forbidden action for a VA", () => {
    for (const action of VA_FORBIDDEN_ACTIONS) {
      expect(() => assertVaMayAct("VA", action)).toThrow(/VA_ACTION_FORBIDDEN/);
    }
  });

  it("never exposes a money action as a grantable permission", () => {
    // The two sets must not overlap: if a forbidden action were also a
    // permission key, a client could tick it in the portal.
    for (const action of VA_FORBIDDEN_ACTIONS) {
      expect(VA_PERMISSION_KEYS as readonly string[]).not.toContain(action);
    }
  });

  it("cannot be unlocked by any permissions blob", () => {
    // Grant literally everything, including the forbidden names, then re-check.
    const everything: Record<string, boolean> = {};
    for (const key of VA_PERMISSION_KEYS) everything[key] = true;
    for (const action of VA_FORBIDDEN_ACTIONS) everything[action] = true;
    parseVaPermissions(everything);
    for (const action of VA_FORBIDDEN_ACTIONS) {
      expect(() => assertVaMayAct("VA", action)).toThrow(/VA_ACTION_FORBIDDEN/);
    }
  });

  it("lets a CLIENT do them — the limit is on delegation, not the action", () => {
    for (const action of VA_FORBIDDEN_ACTIONS) {
      expect(() => assertVaMayAct("CLIENT", action)).not.toThrow();
    }
  });

  it("allows a VA any action that is not on the forbidden list", () => {
    expect(() => assertVaMayAct("VA", "create_booking")).not.toThrow();
  });

  it("keeps invoice VIEWING separate from invoice payment", () => {
    // A client may want their assistant reconciling invoices they cannot pay.
    expect(VA_PERMISSION_KEYS as readonly string[]).toContain("invoicesView");
    expect(() => assertVaMayAct("VA", "invoice_payment")).toThrow(/VA_ACTION_FORBIDDEN/);
  });
});

describe("parseVaPropertyScope", () => {
  it("treats absent, empty or malformed scope as no restriction", () => {
    // Null means "every property this client owns" — the client's own default
    // before they narrow it.
    expect(parseVaPropertyScope(null)).toBeNull();
    expect(parseVaPropertyScope(undefined)).toBeNull();
    expect(parseVaPropertyScope([])).toBeNull();
    expect(parseVaPropertyScope("clx0prop1")).toBeNull();
    expect(parseVaPropertyScope({ ids: ["clx0prop1"] })).toBeNull();
  });

  it("restricts to the listed ids", () => {
    expect(parseVaPropertyScope(["clx0prop1", "clx0prop2"])).toEqual([
      "clx0prop1",
      "clx0prop2",
    ]);
  });

  it("drops blank and non-string entries", () => {
    expect(parseVaPropertyScope(["clx0prop1", "", "   ", 7, null])).toEqual(["clx0prop1"]);
  });

  it("returns null when every entry was junk, rather than an empty allow-list", () => {
    // An empty array here would be ambiguous; null says "unrestricted" and the
    // caller decides. Junk-only input must not silently mean "all properties"
    // by accident — it means the scope was never validly set.
    expect(parseVaPropertyScope([" ", 1, null])).toBeNull();
  });
});
