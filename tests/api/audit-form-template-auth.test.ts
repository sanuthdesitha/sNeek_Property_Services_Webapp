// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ role: "OPS_MANAGER", findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async (roles: string[]) => {
  if (!m.role) throw new Error("UNAUTHORIZED");
  if (!roles.includes(m.role)) throw new Error("FORBIDDEN");
  return { user: { id: "viewer", role: m.role } };
} }));
vi.mock("@/lib/db", () => ({ db: { formTemplate: m } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({}) }));
vi.mock("@/lib/security/admin-verification", () => ({ verifySensitiveAction: vi.fn() }));
import { POST as create, GET as list } from "@/app/api/admin/form-templates/route";
import { PATCH as update, DELETE as remove, GET as read } from "@/app/api/admin/form-templates/[id]/route";
import { POST as duplicate } from "@/app/api/admin/form-templates/[id]/duplicate/route";
import { POST as publish } from "@/app/api/admin/form-templates/[id]/publish/route";
const params = { params: { id: "template" } };
const request = (body = {}) => new NextRequest("http://localhost/api/admin/form-templates?v1=1", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); m.role = "OPS_MANAGER"; m.findMany.mockResolvedValue([]); m.findUnique.mockResolvedValue({ id: "template" }); m.create.mockResolvedValue({ id: "new" }); });
it.each([
  ["create", () => create(request({ name: "New", serviceType: "GENERAL_CLEAN" }))],
  ["update", () => update(request({ name: "Updated" }), params)],
  ["duplicate", () => duplicate(request(), params)],
  ["publish", () => publish(request({ action: "publish" }), params)],
  ["archive", () => publish(request({ action: "archive" }), params)],
  ["unarchive", () => publish(request({ action: "unarchive" }), params)],
  ["delete", () => remove(request(), params)],
] as const)("forbids OPS %s before database access", async (_name, run) => {
  expect((await run()).status).toBe(403);
  for (const fn of [m.findMany, m.findUnique, m.create, m.update, m.updateMany]) expect(fn).not.toHaveBeenCalled();
});
it("preserves OPS listing and reading", async () => {
  expect((await list(request())).status).toBe(200);
  expect((await read(request(), params)).status).toBe(200);
});
it("allows ADMIN creation", async () => {
  m.role = "ADMIN";
  expect((await create(request({ name: "New", serviceType: "GENERAL_CLEAN" }))).status).toBe(201);
  expect(m.create).toHaveBeenCalledOnce();
});

it.each([["", 401], ["CLEANER", 403]] as const)("template reads deny role %s without database access", async (role, status) => {
 m.role = role;
 expect((await list(request())).status).toBe(status);
 expect((await read(request(), params)).status).toBe(status);
 expect(m.findMany).not.toHaveBeenCalled(); expect(m.findUnique).not.toHaveBeenCalled();
});
it("template reads return ordinary lookup failures as errors", async () => {
 m.findMany.mockRejectedValueOnce(new Error("database unavailable"));
 m.findUnique.mockRejectedValueOnce(new Error("database unavailable"));
 expect((await list(request())).status).toBe(400);
 expect((await read(request(), params)).status).toBe(400);
});
it("ADMIN writes require a live session", async () => {
 m.role = "";
 for (const run of [() => create(request()), () => update(request(), params), () => duplicate(request(), params), () => publish(request(), params), () => remove(request(), params)]) {
  expect((await run()).status).toBe(401);
 }
 expect(m.create).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
