/**
 * Owner decision 2026-11-12 (item A): operations managers may send the office
 * messages that were administrator only, each only with the ops pack of the
 * page it lives on at "manage"; administrators unchanged; nobody while
 * impersonating. The send routes are owned by that page's pack too.
 */
import { describe, expect, it } from "vitest";
import { allOpsLevels, canUseOpsPath, opsRequestFeature, type OpsLevels } from "@/lib/rbac/ops-catalog";
import { decideOfficeSend, OFFICE_SEND_POLICIES, type OfficeSendAction } from "@/lib/notifications/office-send-rules";

const ACTIONS = Object.keys(OFFICE_SEND_POLICIES) as OfficeSendAction[];
const levelsWith = (pack: string, level: "off" | "read" | "manage"): OpsLevels => ({ ...allOpsLevels("manage"), [pack]: level } as OpsLevels);

describe("which pack governs each action", () => {
  it("uses the page's pack: Laundry, Lost & found, Jobs", () => {
    expect(Object.fromEntries(ACTIONS.map((action) => [action, OFFICE_SEND_POLICIES[action].pack]))).toEqual({
      supplier_chase: "laundry",
      guest_message: "lost-found",
      lost_item_client_notice: "lost-found",
      client_delay_notice: "jobs",
      account_email: "accounts",
      clock_pause: "jobs",
    });
  });
});

describe("decideOfficeSend", () => {
  it("allows an administrator for every action without reading a pack", () => {
    for (const action of ACTIONS) {
      expect(decideOfficeSend({ heldRoles: ["ADMIN"], impersonating: false, levels: null }, action)).toEqual({ allowed: true, actorRole: "ADMIN", reason: null });
    }
  });

  it("treats a person holding ADMIN and OPS_MANAGER as an administrator (ADMIN never inherits a pack)", () => {
    const decision = decideOfficeSend({ heldRoles: ["OPS_MANAGER", "ADMIN"], impersonating: false, levels: allOpsLevels("off") }, "clock_pause");
    expect(decision).toMatchObject({ allowed: true, actorRole: "ADMIN" });
  });

  it("allows an operations manager only with the action's pack at manage", () => {
    for (const action of ACTIONS) {
      const pack = OFFICE_SEND_POLICIES[action].pack;
      expect(decideOfficeSend({ heldRoles: ["OPS_MANAGER"], impersonating: false, levels: levelsWith(pack, "manage") }, action)).toMatchObject({ allowed: true, actorRole: "OPS_MANAGER" });
      for (const level of ["read", "off"] as const) {
        const refused = decideOfficeSend({ heldRoles: ["OPS_MANAGER"], impersonating: false, levels: levelsWith(pack, level) }, action);
        expect(refused.allowed).toBe(false);
        expect(refused.reason).toContain(`${OFFICE_SEND_POLICIES[action].packLabel} permission`);
      }
    }
  });

  it("does not let another pack stand in for the page's pack", () => {
    const onlyCommunications = { ...allOpsLevels("off"), communications: "manage" } as OpsLevels;
    for (const action of ACTIONS) {
      expect(decideOfficeSend({ heldRoles: ["OPS_MANAGER"], impersonating: false, levels: onlyCommunications }, action).allowed).toBe(false);
    }
  });

  it("fails closed for a manager whose levels could not be resolved", () => {
    expect(decideOfficeSend({ heldRoles: ["OPS_MANAGER"], impersonating: false, levels: null }, "guest_message").allowed).toBe(false);
  });

  it("refuses everyone while impersonating, administrators included, with the right wording", () => {
    for (const heldRoles of [["ADMIN"], ["OPS_MANAGER"]]) {
      expect(decideOfficeSend({ heldRoles, impersonating: true, levels: allOpsLevels("manage") }, "supplier_chase")).toMatchObject({ allowed: false, reason: expect.stringMatching(/^Messages cannot be sent while impersonating/) });
    }
    expect(decideOfficeSend({ heldRoles: ["ADMIN"], impersonating: true, levels: null }, "clock_pause").reason).toMatch(/^A clock cannot be paused while impersonating/);
  });

  it("refuses roles that are neither", () => {
    expect(decideOfficeSend({ heldRoles: ["CLEANER"], impersonating: false, levels: null }, "client_delay_notice")).toMatchObject({ allowed: false, reason: expect.stringMatching(/Only administrators and operations managers/) });
  });
});

describe("route ownership for the shared middleware and the live session guard", () => {
  it("assigns the notifications-area send routes to the page's pack, leaving the others with communications", () => {
    expect(opsRequestFeature("/api/admin/notifications/actions/supplier-chase")).toBe("laundry");
    expect(opsRequestFeature("/api/admin/notifications/actions/guest-message")).toBe("lost-found");
    expect(opsRequestFeature("/api/admin/notifications/actions/client-delay")).toBe("jobs");
    expect(opsRequestFeature("/api/admin/notifications/actions/staff-message")).toBe("communications");
    expect(opsRequestFeature("/api/admin/notifications/actions/laundry-nudge")).toBe("communications");
    expect(opsRequestFeature("/api/admin/notifications/deliveries")).toBe("communications");
  });

  it("lets a POST through only with that pack at manage", () => {
    const laundryOnly = { ...allOpsLevels("off"), laundry: "manage" } as OpsLevels;
    expect(canUseOpsPath(laundryOnly, "/api/admin/notifications/actions/supplier-chase", "POST")).toBe(true);
    expect(canUseOpsPath(laundryOnly, "/api/admin/notifications/actions/client-delay", "POST")).toBe(false);
    expect(canUseOpsPath({ ...laundryOnly, laundry: "read" }, "/api/admin/notifications/actions/supplier-chase", "POST")).toBe(false);
    expect(canUseOpsPath({ ...allOpsLevels("off"), jobs: "read" }, "/api/admin/notifications/actions/client-delay", "GET")).toBe(true);
  });
});
