// @vitest-environment node
/** Assigning a cleaner on recorded leave needs the explicit override; a cancelled job is never assigned. */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), job: vi.fn(), users: vi.fn(), leave: vi.fn(), settings: vi.fn(), remove: vi.fn(), upsert: vi.fn(), current: vi.fn(), update: vi.fn(), audit: vi.fn(), notification: vi.fn(), many: vi.fn(), rules: vi.fn(), attach: vi.fn(), lifecycle: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { staffLeave: { findMany: m.leave }, job: { findUnique: m.job }, user: { findMany: m.users }, auditLog: { create: m.audit }, notification: { create: m.notification, createMany: m.many }, $transaction: (fn: (tx: unknown) => unknown) => fn({ jobAssignment: { updateMany: m.remove, upsert: m.upsert, findMany: m.current }, job: { update: m.update } }) } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn() }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn() }));
vi.mock("@/lib/phase4/notification-rules", () => ({ resolveNotificationRuleRecipients: m.rules }));
vi.mock("@/lib/job-tasks/service", () => ({ attachPendingAdminTasksToJob: m.attach }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle, previewLifecycleEmail: vi.fn() }));
import { POST } from "@/app/api/admin/jobs/[id]/assign/route";

type JobFixture = { id: string; propertyId: string; status: string; jobType: string; scheduledDate: Date; internalNotes: null; assignments: unknown[]; property: { name: string } };
let job: JobFixture;
beforeEach(() => {
  vi.resetAllMocks();
  job = { id: "j", propertyId: "p", status: "UNASSIGNED", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-13T00:00:00Z"), internalNotes: null, assignments: [], property: { name: "Home" } };
  m.auth.mockResolvedValue({ user: { id: "admin" } });
  m.job.mockImplementation(async () => job);
  m.users.mockResolvedValue([{ id: "c", name: "Jane" }]);
  m.leave.mockResolvedValue([{ id: "l", userId: "c", startDate: new Date("2026-11-12T00:00:00Z"), endDate: new Date("2026-11-14T00:00:00Z"), kind: "LEAVE", note: null }]);
  m.settings.mockResolvedValue({ notificationTemplates: {} });
  m.current.mockResolvedValue([{ responseStatus: "PENDING", removedAt: null }]);
  m.rules.mockResolvedValue({ recipients: [] });
  m.lifecycle.mockResolvedValue({});
});
const post = (body: Record<string, unknown>) => POST(new NextRequest("http://localhost", { method: "POST", body: JSON.stringify(body) }), { params: { id: "j" } });

it("refuses a cleaner on leave that day with the reason, writing nothing", async () => {
  const response = await post({ userIds: ["c"] });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "LEAVE_CONFLICT", error: "Jane: On leave 12–14 Nov", conflicts: [{ userId: "c", reason: "On leave 12–14 Nov" }] });
  expect(m.upsert).not.toHaveBeenCalled();
});

it("assigns with the explicit override", async () => {
  const response = await post({ userIds: ["c"], confirmLeaveConflict: true });
  expect(response.status).toBe(200);
  expect(m.upsert).toHaveBeenCalled();
});

it("never assigns a cancelled job", async () => {
  job.status = "CANCELLED";
  const response = await post({ userIds: ["c"], confirmLeaveConflict: true });
  expect(response.status).toBe(409);
  expect(m.upsert).not.toHaveBeenCalled();
});
