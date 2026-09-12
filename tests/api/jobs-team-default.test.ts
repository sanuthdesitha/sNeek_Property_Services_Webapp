// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/admin/jobs-team-default/route";
import { requireJobsViewsContext } from "@/lib/jobs/views-context";
import { emptyJobsTeamDefault } from "@/lib/jobs/team-default";
const mocks = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: mocks.session }));
vi.mock("@/lib/jobs/team-default-store", () => ({ readJobsTeamDefault: mocks.read, publishJobsTeamDefault: mocks.publish }));
vi.mock("@/lib/db", () => ({ db: {} }));
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); mocks.read.mockResolvedValue(emptyJobsTeamDefault()); mocks.publish.mockResolvedValue(emptyJobsTeamDefault()); });
async function request(write: boolean, context?: string) {
  const identity = await requireJobsViewsContext();
  return (write ? PATCH : GET)(new NextRequest("http://localhost/api/admin/jobs-team-default", { method: write ? "PATCH" : "GET", headers: { "x-jobs-view-context": context ?? identity.context }, ...(write ? { body: JSON.stringify({ revision: 0, snapshot: null }) } : {}) }));
}
it.each(["ADMIN", "OPS_MANAGER"])("allows scoped %s reads and reports publication capability", async role => {
  mocks.session.mockResolvedValue({ user: { id: "actor", role } });
  const response = await request(false); expect(response.status).toBe(200);
  expect((await response.json()).canPublish).toBe(role === "ADMIN"); expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("publishes only as the current admin", async () => {
  expect((await request(true)).status).toBe(200);
  expect(mocks.publish).toHaveBeenCalledWith("admin", { revision: 0, snapshot: null });
});
it.each([
  { user: { id: "ops", role: "OPS_MANAGER" } },
  { user: { id: "admin", role: "ADMIN" }, impersonation: { actorId: "owner", mode: "INTERACTIVE", startedAt: 1 } },
  { user: { id: "admin", role: "ADMIN" }, impersonation: { actorId: "owner", mode: "READ_ONLY", startedAt: 1 } },
])("rejects nonowner-role or impersonated publication %j", async session => {
  mocks.session.mockResolvedValue(session); expect((await request(true)).status).toBe(403); expect(mocks.publish).not.toHaveBeenCalled();
});
it("rejects a previous account context without reads or writes", async () => {
  expect((await request(true, "other-context")).status).toBe(409); expect(mocks.publish).not.toHaveBeenCalled();
});
it("does not expose storage diagnostics", async () => {
  mocks.read.mockRejectedValue(new Error("credentials secret")); const response = await request(false);
  expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("credentials");
});

it.each(["UNAUTHORIZED", "FORBIDDEN"])("preserves the session denial %s", async message => {
  mocks.session.mockRejectedValue(new Error(message));
  const response = await GET(new NextRequest("http://localhost/api/admin/jobs-team-default", { headers: { "x-jobs-view-context": "old" } }));
  expect(response.status).toBe(message === "UNAUTHORIZED" ? 401 : 403);
  expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
});
