import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireRole: vi.fn(), opsAccess: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.requireRole }));
vi.mock("@/lib/rbac/ops-access", () => ({ getOpsAccess: m.opsAccess }));
vi.mock("@/lib/dashboard/work-queue", () => ({ buildWorkQueue: m.queue }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));

import { GET } from "@/app/api/admin/command/[section]/route";
import { allOpsLevels } from "@/lib/rbac/ops-catalog";
import { opsRequestFeature } from "@/lib/rbac/ops-catalog";

const call = (section: string) => GET(new Request(`http://x/api/admin/command/${section}`), { params: { section } });

beforeEach(() => {
  vi.resetAllMocks();
  m.requireRole.mockResolvedValue({ user: { id: "u1", role: "OPS_MANAGER" } });
  m.opsAccess.mockResolvedValue(null);
  m.queue.mockResolvedValue({ items: [], chips: [], unavailable: [], generatedAt: "x" });
});

it("checks the live session and office roles on every request", async () => {
  m.requireRole.mockRejectedValue(new Error("UNAUTHORIZED"));
  expect((await call("queue")).status).toBe(401);
  m.requireRole.mockRejectedValue(new Error("FORBIDDEN"));
  expect((await call("queue")).status).toBe(403);
  expect(m.requireRole).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});

it("passes the viewer's packs and read-only state to the queue", async () => {
  const levels = allOpsLevels("read");
  m.opsAccess.mockResolvedValue(levels);
  m.requireRole.mockResolvedValue({ user: { id: "u1", role: "OPS_MANAGER" }, impersonation: { mode: "READ_ONLY" } });
  expect((await call("queue")).status).toBe(200);
  expect(m.queue).toHaveBeenCalledWith({ levels, readOnly: true }, expect.anything());
});

it("refuses the money section without finance or payroll, and unknown sections", async () => {
  m.opsAccess.mockResolvedValue({ ...allOpsLevels("manage"), finance: "off", payroll: "off" });
  expect((await call("money")).status).toBe(403);
  expect((await call("secrets")).status).toBe(404);
});

it("belongs to the dashboard pack, like the Command page", () => {
  expect(opsRequestFeature("/api/admin/command/queue")).toBe("dashboard");
  // Live ops moved from the System pack to the Dashboard pack (live location
  // 2026-11, default pending owner confirmation); other /admin/ops tools stay System.
  expect(opsRequestFeature("/api/admin/ops/live-board")).toBe("dashboard");
  expect(opsRequestFeature("/api/admin/ops/sla/run")).toBe("system");
});
