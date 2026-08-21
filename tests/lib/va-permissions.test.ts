import { describe, it, expect } from "vitest";
import {
  VA_PERMISSION_KEYS,
  VA_FORBIDDEN_ACTIONS,
  parseVaPermissions,
  emptyVaPermissions,
  hasVaPermission,
  assertVaMayAct,
  parseVaPropertyScope,
  VA_PERMISSION_LABELS,
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

/**
 * PER-TASK SUB-PERMISSIONS (2026-08). "Can they touch tasks" was too coarse:
 * an assistant who may raise a request is not automatically one who may rewrite
 * it after an admin has read it.
 */
describe("task sub-permissions", () => {
  it("grants nothing new to a team that was granted nothing", () => {
    const permissions = parseVaPermissions({ bookings: false, tasksCreate: false });
    expect(permissions.tasksCreate).toBe(false);
    expect(permissions.tasksEditOwn).toBe(false);
    expect(permissions.tasksWithdrawOwn).toBe(false);
  });

  it("does not revoke task creation from a team granted before the keys existed", () => {
    // The regression this guards: reading an absent key as `false` is right for
    // a NEW capability and wrong for tasksCreate, which every VA with bookings
    // already has. It would have read as "the portal broke" on deploy.
    const legacy = parseVaPermissions({ bookings: true, reports: true });
    expect(legacy.tasksCreate).toBe(true);
    // But the genuinely new capabilities stay off — nobody had them, so nobody
    // loses them, and inheriting these would be a silent WIDENING.
    expect(legacy.tasksEditOwn).toBe(false);
    expect(legacy.tasksWithdrawOwn).toBe(false);
  });

  it("stops inheriting once the team has been saved with the keys", () => {
    const saved = parseVaPermissions({ bookings: true, tasksCreate: false });
    expect(saved.tasksCreate).toBe(false);
  });

  it("treats a legacy team without bookings as having no task creation", () => {
    expect(parseVaPermissions({ reports: true }).tasksCreate).toBe(false);
  });

  it("never grants task creation from an unreadable blob", () => {
    expect(parseVaPermissions(null).tasksCreate).toBe(false);
    expect(parseVaPermissions("bookings").tasksCreate).toBe(false);
    expect(parseVaPermissions([]).tasksCreate).toBe(false);
  });

  it("labels every grantable key, including the new ones", () => {
    // A key with no label renders as a blank toggle the client cannot judge.
    for (const key of VA_PERMISSION_KEYS) {
      expect(VA_PERMISSION_LABELS[key]?.title, `${key} has no label`).toBeTruthy();
      expect(VA_PERMISSION_LABELS[key]?.hint, `${key} has no hint`).toBeTruthy();
    }
  });
});

describe("task edits no grant can permit", () => {
  it("refuses a VA editing someone else's request", () => {
    expect(() => assertVaMayAct("VA", "task_edit_foreign")).toThrow("VA_ACTION_FORBIDDEN");
  });

  it("refuses a VA editing an already-approved request", () => {
    // The approval was a decision taken about a specific piece of text.
    // Letting the text change afterwards would make the approval mean nothing.
    expect(() => assertVaMayAct("VA", "task_edit_approved")).toThrow("VA_ACTION_FORBIDDEN");
  });

  it("does not restrict the client themselves", () => {
    expect(() => assertVaMayAct("CLIENT", "task_edit_approved")).not.toThrow();
  });

  it("keeps the money rule ungrantable alongside the new ones", () => {
    for (const action of ["quote_approval", "extra_approval", "cost_approval", "invoice_payment"]) {
      expect(() => assertVaMayAct("VA", action)).toThrow("VA_ACTION_FORBIDDEN");
    }
  });
});
