// @vitest-environment node
/** System health stays ADMIN only (owner default, as Diagnostics was): live role guard on every read. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const { role, read } = vi.hoisted(() => ({ role: { value: "ADMIN" }, read: vi.fn(async () => ({ areas: [], support: "text" })) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: vi.fn(async (roles: string[]) => {
    if (!roles.includes(role.value)) throw new Error("FORBIDDEN");
    return { user: { id: "u", role: role.value } };
  }),
}));
vi.mock("@/lib/ops/system-health", () => ({ readSystemHealth: read }));

import { GET } from "@/app/api/admin/system/health/route";

describe("System health route", () => {
  it("refuses operations managers and anyone else; answers administrators", async () => {
    for (const value of ["OPS_MANAGER", "CLEANER", "CLIENT"]) {
      role.value = value;
      expect((await GET()).status).toBe(403);
    }
    role.value = "ADMIN";
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a failed read is an error, never an empty healthy page", async () => {
    role.value = "ADMIN";
    read.mockRejectedValueOnce(new Error("db down"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("System health could not be read.");
  });

  it("the menu entry is administrators only and named System health", () => {
    expect(readFileSync("app/v2/admin/layout.tsx", "utf8")).toContain('{ href: "/v2/admin/diagnostics", label: "System health", icon: ShieldCheck, group: "System", adminOnly: true }');
  });
});
