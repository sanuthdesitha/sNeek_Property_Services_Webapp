// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), property: vi.fn(), find: vi.fn(), create: vi.fn(), next: vi.fn(), final: vi.fn(), attach: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { property: { findUnique: m.property }, $transaction: (fn: any) => fn({ $queryRaw: m.lock, jobTask: { findUnique: m.find, create: m.create, findUniqueOrThrow: m.final }, job: { findFirst: m.next } }) } }));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingAdminTasksToJob: m.attach }));
import { POST } from "@/app/api/admin/properties/[id]/pending-tasks/route";
const id = "56c60ce2-bd94-4cb2-8a65-b8ca06bfe0d7";
beforeEach(() => { vi.resetAllMocks(); m.auth.mockResolvedValue({ user: { id: "admin" } }); m.property.mockResolvedValue({ id: "p" }); m.find.mockResolvedValue(null); m.create.mockResolvedValue({ id: "task" }); m.final.mockResolvedValue({ id: "task", jobId: "today" }); m.next.mockResolvedValue({ id: "today" }); });
const post = () => POST(new NextRequest("http://localhost/api/admin/properties/p/pending-tasks", { method: "POST", body: JSON.stringify({ requestId: id, title: "Detail" }) }), { params: { id: "p" } });
it("defaults photo proof on, atomically attaches, and returns actual target", async () => {
  const response = await post(); expect(response.status).toBe(201); expect(await response.json()).toEqual({ id: "task", jobId: "today" });
  expect(m.create.mock.calls[0][0].data.requiresPhoto).toBe(true); expect(m.attach.mock.calls[0][0].database).toBeDefined();
  const lower = m.next.mock.calls[0][0].where.scheduledDate.gte;
  expect(lower.getTime()).toBeLessThanOrEqual(Date.now());
});
it("same request replay returns original task without creating/attaching again", async () => {
  m.find.mockResolvedValue({ id: "saved", title: "Detail", description: null, requiresPhoto: true, requiresNote: false, jobId: "today" });
  expect((await post()).status).toBe(201); expect(m.create).not.toHaveBeenCalled(); expect(m.attach).not.toHaveBeenCalled();
});
it("replayed key with different content is rejected rather than silently changing task", async () => {
  m.find.mockResolvedValue({ id: "saved", title: "Other", description: null, requiresPhoto: true, requiresNote: false });
  expect((await post()).status).toBe(400); expect(m.create).not.toHaveBeenCalled();
});
