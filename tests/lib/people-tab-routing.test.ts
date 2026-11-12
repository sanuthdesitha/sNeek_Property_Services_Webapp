/**
 * People page tabs and their packs: Clients = clients, Cleaners = workforce,
 * everything else = Staff accounts. Data routes keep their own packs and
 * cannot be steered by a query string.
 */
import { describe, expect, it } from "vitest";
import { allOpsLevels, canUseOpsPath, opsNavigationHref, opsRequestFeature, type OpsLevels } from "@/lib/rbac/ops-catalog";

const only = (changes: Partial<OpsLevels>): OpsLevels => ({ ...allOpsLevels("off"), ...changes });

describe("People page tabs", () => {
  it("maps the Clients tab to clients and the Cleaners tab to workforce; the rest to accounts", () => {
    expect(opsRequestFeature("/v2/admin/accounts?tab=clients")).toBe("clients");
    expect(opsRequestFeature("/v2/admin/accounts?tab=cleaners")).toBe("workforce");
    expect(opsRequestFeature(`/_accounts/${"a".repeat(32)}/v2/admin/accounts?tab=clients`)).toBe("clients");
    for (const tab of ["", "office", "partners", "assistants", "invitations", "everyone", "attention", "logins", "team"]) {
      expect(opsRequestFeature(`/v2/admin/accounts${tab ? `?tab=${tab}` : ""}`), tab).toBe("accounts");
    }
  });

  it("a clients-only manager reaches the Clients tab and its data routes, and nothing else on the page", () => {
    const levels = only({ clients: "manage" });
    expect(canUseOpsPath(levels, "/v2/admin/accounts?tab=clients")).toBe(true);
    expect(canUseOpsPath(levels, "/v2/admin/accounts?tab=cleaners")).toBe(false);
    expect(canUseOpsPath(levels, "/v2/admin/accounts?tab=office")).toBe(false);
    expect(canUseOpsPath(levels, "/v2/admin/accounts")).toBe(false);
    expect(canUseOpsPath(levels, "/api/admin/clients/directory")).toBe(true);
    expect(canUseOpsPath(levels, "/api/admin/clients/c1/summary")).toBe(true);
    expect(canUseOpsPath(levels, "/api/admin/clients/bulk", "POST")).toBe(true);
    expect(canUseOpsPath(only({ clients: "read" }), "/api/admin/clients/bulk", "POST")).toBe(false);
    expect(canUseOpsPath(levels, "/api/admin/users?paginated=1&tab=cleaners")).toBe(false);
    expect(opsNavigationHref(levels, "/v2/admin/accounts")).toBe("/v2/admin/accounts?tab=clients");
  });

  it("a workforce-only manager reaches the Cleaners tab, not the others; API paths are not steered by the tab", () => {
    const levels = only({ workforce: "read" });
    expect(canUseOpsPath(levels, "/v2/admin/accounts?tab=cleaners")).toBe(true);
    expect(canUseOpsPath(levels, "/v2/admin/accounts?tab=clients")).toBe(false);
    expect(opsNavigationHref(levels, "/v2/admin/accounts")).toBe("/v2/admin/accounts?tab=cleaners");
    expect(opsRequestFeature("/api/admin/accounts?tab=clients")).toBe("accounts");
    expect(opsRequestFeature("/api/admin/users?tab=cleaners")).toBe("accounts");
  });

  it("the workforce Cleaners list route belongs to the workforce pack only; other People routes stay with accounts", () => {
    expect(opsRequestFeature("/api/admin/people/cleaners?tab=everyone")).toBe("workforce");
    expect(opsRequestFeature("/api/admin/people/cleaners/export")).toBe("workforce");
    expect(opsRequestFeature("/api/admin/people/other")).toBe("accounts");
    expect(canUseOpsPath(only({ workforce: "read" }), "/api/admin/people/cleaners")).toBe(true);
    expect(canUseOpsPath(only({ accounts: "manage" }), "/api/admin/people/cleaners")).toBe(false);
  });

  it("the accounts pack still opens every tab; no pack opens none", () => {
    const accounts = only({ accounts: "read" });
    expect(canUseOpsPath(accounts, "/v2/admin/accounts?tab=office")).toBe(true);
    expect(canUseOpsPath(accounts, "/v2/admin/accounts")).toBe(true);
    expect(opsNavigationHref(allOpsLevels("off"), "/v2/admin/accounts")).toBeNull();
  });
});
