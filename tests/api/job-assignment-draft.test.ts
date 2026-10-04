// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), job: vi.fn(), users: vi.fn(), settings: vi.fn(), remove: vi.fn(), upsert: vi.fn(), current: vi.fn(), update: vi.fn(), audit: vi.fn(), notification: vi.fn(), many: vi.fn(), rules: vi.fn(), attach: vi.fn(), lifecycle: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { job: { findUnique: m.job }, user: { findMany: m.users }, auditLog: { create: m.audit }, notification: { create: m.notification, createMany: m.many }, $transaction: (fn: any) => fn({ jobAssignment: { updateMany: m.remove, upsert: m.upsert, findMany: m.current }, job: { update: m.update } }) } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn() }));
vi.mock("@/lib/phase4/notification-rules", () => ({ resolveNotificationRuleRecipients: m.rules }));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingAdminTasksToJob: m.attach }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle, previewLifecycleEmail: vi.fn() }));
import { serializeJobInternalNotes } from "@/lib/jobs/meta";
import { POST } from "@/app/api/admin/jobs/[id]/assign/route";
let job: any;
beforeEach(() => { vi.resetAllMocks(); job = { id: "j", propertyId: "p", status: "UNASSIGNED", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-10-01"), internalNotes: serializeJobInternalNotes({ isDraft: true }), assignments: [], property: { name: "Home" } }; m.auth.mockResolvedValue({ user: { id: "admin" } }); m.job.mockImplementation(async () => job); m.users.mockResolvedValue([]); m.settings.mockResolvedValue({ notificationTemplates: {} }); m.current.mockResolvedValue([]); m.rules.mockResolvedValue({ recipients: [] }); m.lifecycle.mockResolvedValue({}); });
const post = (userIds: string[]) => POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify({ userIds }) }), { params: { id: "j" } });
it("draft cannot dispatch cleaners or notify anyone", async () => {
 expect((await post(["cleaner"])).status).toBe(409); expect(m.users).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.notification).not.toHaveBeenCalled();
});
it("draft assignments can be explicitly cleared", async () => {
 expect((await post([])).status).toBe(200); expect(m.remove).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "j", removedAt: null } })); expect(m.upsert).not.toHaveBeenCalled();
});
it("published assignment queues mobile markers for cleaner and additional rule recipients", async () => {
 job.internalNotes = null; m.users.mockResolvedValue([{ id: "c", name: "Cleaner" }]); m.current.mockResolvedValue([{ responseStatus: "PENDING", removedAt: null }]); m.rules.mockResolvedValue({ recipients: [{ userId: "c" }, { userId: "ops" }] });
 expect(await (await post(["c"])).json()).toMatchObject({ ok: true });
 expect(m.notification.mock.calls[0][0].data).toMatchObject({ userId: "c", channel: "PUSH", externalId: expect.any(String) });
 expect(m.many.mock.calls[0][0].data).toEqual([expect.objectContaining({ userId: "ops", externalId: expect.any(String) })]);
});
it.each([["UNAUTHORIZED",401],["FORBIDDEN",403]])("denies %s before reading assignments", async (message,status) => {
 m.auth.mockRejectedValue(new Error(String(message))); expect((await post([])).status).toBe(status); expect(m.job).not.toHaveBeenCalled();
});
