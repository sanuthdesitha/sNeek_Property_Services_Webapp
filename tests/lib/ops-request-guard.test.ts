// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ setting: vi.fn(), headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: () => m.headers }));
vi.mock("@/lib/db", () => ({ db: { appSetting: { findUnique: m.setting } } }));
import { enforceOpsRequest } from "@/lib/rbac/ops-access";
const user = { id: "manager", role: "OPS_MANAGER", heldRoles: ["OPS_MANAGER"] };
beforeEach(() => { m.headers = new Headers({ "x-sneek-request-path": "/api/admin/jobs/job", "x-sneek-request-method": "POST" }); m.setting.mockResolvedValue({ value: { revision: 1, presets: [], assignments: { manager: { presetId: "observer", overrides: {} } } } }); });
it("blocks direct mutations while allowing safe reads", async () => {
  await expect(enforceOpsRequest(user)).rejects.toThrow("FORBIDDEN");
  m.headers.set("x-sneek-request-method", "GET");
  await expect(enforceOpsRequest(user)).resolves.toBeUndefined();
});
it("fails closed without trusted middleware metadata or with malformed policy", async () => {
  m.headers.delete("x-sneek-request-path"); await expect(enforceOpsRequest(user)).rejects.toThrow("FORBIDDEN");
  m.headers.set("x-sneek-request-path", "/api/admin/jobs"); m.setting.mockResolvedValue({ value: {} }); await expect(enforceOpsRequest(user)).rejects.toThrow();
});
it("keeps self-service available and does not restrict administrators", async () => {
  m.headers.set("x-sneek-request-path", "/api/me/profile"); await expect(enforceOpsRequest(user)).resolves.toBeUndefined();
  m.headers.set("x-sneek-request-path", "/api/admin/ops-permissions"); await expect(enforceOpsRequest({ ...user, heldRoles: ["ADMIN", "OPS_MANAGER"] })).resolves.toBeUndefined();
  await expect(enforceOpsRequest(user)).rejects.toThrow("FORBIDDEN");
});
