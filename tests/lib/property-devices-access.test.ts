// @vitest-environment node
/**
 * Property devices (2026-11-20): who may do what.
 * - Operations managers reach a property's devices through the existing
 *   Properties pack: read to view, manage to add devices and enter readings.
 * - Connections, location links, thresholds and Sync now are ADMIN only in
 *   every route; connecting, replacing Minut credentials and disconnecting are
 *   confirmed with the person's own PIN in the same request.
 * - Every route calls the live session/role guard.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { canUseOpsPath, OPS_FEATURE_KEYS, type OpsLevels } from "@/lib/rbac/ops-catalog";

const ROOT = process.cwd();

function levels(overrides: Partial<OpsLevels>): OpsLevels {
  return { ...(Object.fromEntries(OPS_FEATURE_KEYS.map((key) => [key, "none"])) as OpsLevels), ...overrides };
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === "route.ts" ? [path] : [];
  });
}

describe("operations manager packs", () => {
  it("Properties read views devices; manage adds devices and readings; no pack sees nothing", () => {
    const read = levels({ properties: "read" });
    const manage = levels({ properties: "manage" });
    const none = levels({});
    expect(canUseOpsPath(read, "/api/admin/properties/p1/devices", "GET")).toBe(true);
    expect(canUseOpsPath(read, "/api/admin/properties/p1/devices", "POST")).toBe(false);
    expect(canUseOpsPath(read, "/api/admin/properties/p1/devices/d1/readings", "POST")).toBe(false);
    expect(canUseOpsPath(manage, "/api/admin/properties/p1/devices/d1/readings", "POST")).toBe(true);
    expect(canUseOpsPath(read, "/api/admin/property-devices/attention", "GET")).toBe(true);
    expect(canUseOpsPath(none, "/api/admin/property-devices/attention", "GET")).toBe(false);
    expect(canUseOpsPath(none, "/api/admin/properties/p1/devices", "GET")).toBe(false);
  });

  it("the settings tab follows the integrations pack for viewing the menu; its routes stay ADMIN only", () => {
    expect(canUseOpsPath(levels({ integrations: "read" }), "/v2/admin/settings?tab=property-devices", "GET")).toBe(true);
    expect(canUseOpsPath(levels({ properties: "manage" }), "/v2/admin/settings?tab=property-devices", "GET")).toBe(false);
  });
});

describe("route guards", () => {
  const connectionRoutes = routeFiles(join(ROOT, "app/api/admin/integrations/devices"));
  const deviceRoutes = [...routeFiles(join(ROOT, "app/api/admin/properties/[id]/devices")), join(ROOT, "app/api/admin/properties/[id]/device-settings/route.ts"), join(ROOT, "app/api/admin/property-devices/attention/route.ts")];

  it("every connection route is ADMIN only through the live guard", () => {
    expect(connectionRoutes.length).toBeGreaterThanOrEqual(6);
    for (const file of connectionRoutes) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(ROOT, file)).toMatch(/requireRole\(\[Role\.ADMIN\]\)/);
      expect(source, relative(ROOT, file)).not.toContain("OPS_MANAGER");
    }
  });

  it("connecting, replacing Minut credentials and disconnecting verify the person's own PIN", () => {
    for (const name of ["ring", "minut", "disconnect"]) {
      const source = readFileSync(join(ROOT, `app/api/admin/integrations/devices/${name}/route.ts`), "utf8");
      expect(source).toContain("routeSecurityRefusal(session");
    }
  });

  it("every device route calls the live guard; thresholds are ADMIN only", () => {
    for (const file of deviceRoutes) expect(readFileSync(file, "utf8"), relative(ROOT, file)).toMatch(/requireRole\(\[Role\.ADMIN/);
    expect(readFileSync(join(ROOT, "app/api/admin/properties/[id]/device-settings/route.ts"), "utf8")).toMatch(/requireRole\(\[Role\.ADMIN\]\)/);
    const deviceRoute = readFileSync(join(ROOT, "app/api/admin/properties/[id]/devices/[deviceId]/route.ts"), "utf8");
    expect(deviceRoute).toContain("Only an administrator sets a device's own threshold.");
  });

  it("no connection route returns a token, password, code or secret", () => {
    for (const file of connectionRoutes) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(ROOT, file)).not.toMatch(/NextResponse\.json\([^)]*(refreshToken|password|clientSecret|twoFactorCode)/);
    }
  });
});
