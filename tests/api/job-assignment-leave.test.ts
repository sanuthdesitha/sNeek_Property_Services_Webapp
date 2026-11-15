// @vitest-environment node
/** Assigning a cleaner on recorded leave needs the explicit override; a cancelled job is never assigned. */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ documents: vi.fn(), auth: vi.fn(), job: vi.fn(), users: vi.fn(), leave: vi.fn(), settings: vi.fn(), remove: vi.fn(), upsert: vi.fn(), current: vi.fn(), update: vi.fn(), audit: vi.fn(), notification: vi.fn(), many: vi.fn(), rules: vi.fn(), attach: vi.fn(), lifecycle: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.auth }));
vi.mock("@/lib/db", () => ({ db: { staffDocument: { findMany: m.documents }, staffLeave: { findMany: m.leave }, job: { findUnique: m.job }, user: { findMany: m.users }, auditLog: { create: m.audit }, notification: { create: m.notification, createMany: m.many }, $transaction: (fn: (tx: unknown) => unknown) => fn({ jobAssignment: { updateMany: m.remove, upsert: m.upsert, findMany: m.current }, job: { update: m.update } }) } }));
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
  m.documents.mockResolvedValue([]);
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

it("warns about an expired police check like leave: 409 with the reason, then assigns with the override and audits it", async () => {
  m.leave.mockResolvedValue([]);
  m.users.mockResolvedValue([{ id: "c", name: "Jane", email: null, visaExpiry: null }]);
  m.documents.mockResolvedValue([
    { userId: "c", category: "POLICE_CHECK", status: "VERIFIED", expiresAt: new Date("2026-11-02T00:00:00Z") },
    { userId: "c", category: "POLICE_CHECK", status: "REJECTED", expiresAt: new Date("2029-01-01T00:00:00Z") },
  ]);
  const refused = await post({ userIds: ["c"] });
  expect(refused.status).toBe(409);
  const body = await refused.json();
  expect(body).toMatchObject({ code: "LEAVE_CONFLICT", error: "Jane: police check expired 2 Nov 2026", documentWarnings: [{ userId: "c", kind: "POLICE_CHECK", expiredOn: "2026-11-02" }] });
  expect(m.upsert).not.toHaveBeenCalled();

  const assigned = await post({ userIds: ["c"], confirmLeaveConflict: true });
  expect(assigned.status).toBe(200);
  expect(m.upsert).toHaveBeenCalled();
  const override = m.audit.mock.calls.map((call) => call[0].data).find((data) => data.action === "ASSIGNMENT_WARNING_OVERRIDDEN");
  expect(override).toMatchObject({ userId: "admin", entityId: "j", after: { leave: [], documents: [{ userId: "c", kind: "POLICE_CHECK", expiredOn: "2026-11-02" }] } });
});

it("an expired visa warns; a renewed police check or a missing one does not", async () => {
  m.leave.mockResolvedValue([]);
  m.users.mockResolvedValue([{ id: "c", name: "Jane", email: null, visaExpiry: new Date("2026-11-10T00:00:00Z") }]);
  m.documents.mockResolvedValue([
    { userId: "c", category: "POLICE_CHECK", status: "VERIFIED", expiresAt: new Date("2026-01-02T00:00:00Z") },
    { userId: "c", category: "POLICE_CHECK", status: "VERIFIED", expiresAt: new Date("2029-01-02T00:00:00Z") },
  ]);
  const refused = await post({ userIds: ["c"] });
  expect((await refused.json()).error).toBe("Jane: visa / right to work expired 10 Nov 2026");

  m.users.mockResolvedValue([{ id: "c", name: "Jane", email: null, visaExpiry: null }]);
  m.documents.mockResolvedValue([]);
  expect((await post({ userIds: ["c"] })).status).toBe(200);
  expect(m.audit.mock.calls.some((call) => call[0].data.action === "ASSIGNMENT_WARNING_OVERRIDDEN")).toBe(false);
});

it("does not change who may assign: the role gate is unchanged", async () => {
  m.auth.mockRejectedValue(new Error("FORBIDDEN"));
  expect((await post({ userIds: ["c"], confirmLeaveConflict: true })).status).toBe(403);
  expect(m.auth).toHaveBeenCalledWith(["ADMIN", "OPS_MANAGER"]);
});
