// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { notifyAdminsOfNewProfile } from "@/lib/notifications/profile-created";
import { sendClientJobNotification } from "@/lib/notifications/client-job-notifications";
const m = vi.hoisted(() => ({ admins: vi.fn(), job: vi.fn(), create: vi.fn(), createMany: vi.fn(), preferences: vi.fn(), email: vi.fn(), sms: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { findMany: m.admins }, job: { findUnique: m.job }, notification: { create: m.create, createMany: m.createMany } } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "Company" }) }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://example.invalid${path}` }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "New account", html: "<p>New account</p>" }) }));
vi.mock("@/lib/notification-templates", () => ({ renderNotificationTemplate: () => ({ webSubject: "New account", webBody: "Account created" }) }));
vi.mock("@/lib/notifications/preferences", () => ({ canDeliverNotification: m.preferences }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
beforeEach(() => {
  vi.clearAllMocks();
  m.admins.mockResolvedValue([{ id: "admin", role: "ADMIN", email: "admin@example.invalid" }]);
  m.preferences.mockResolvedValue(true); m.email.mockResolvedValue({ ok: true }); m.sms.mockResolvedValue({ ok: true, status: "sent" });
  m.job.mockResolvedValue({ id: "job", property: { name: "Property", client: { notificationPref: null, users: [{ id: "client", email: null, phone: null }] } }, assignments: [] });
});
it("marks each bulk administrator notification with account category for post-commit dispatch", async () => {
  m.admins.mockResolvedValue([{ id: "admin" }, { id: "ops" }]);
  expect(await notifyAdminsByPush({ subject: "Alert", body: "Review needed", jobId: "job" })).toEqual({ count: 2 });
  const rows = m.createMany.mock.calls[0][0].data;
  expect(rows.map((row: { userId: string }) => row.userId)).toEqual(["admin", "ops"]);
  for (const row of rows) expect(row).toMatchObject({ channel: "PUSH", externalId: "mobile-outbox:pending:account", jobId: "job", status: "SENT" });
  expect(m.email).not.toHaveBeenCalled(); expect(m.sms).not.toHaveBeenCalled();
});
it("does not insert a bulk notification when no active admins exist", async () => {
  m.admins.mockResolvedValue([]);
  expect(await notifyAdminsByPush({ subject: "Alert", body: "Review" })).toEqual({ count: 0 });
  expect(m.createMany).not.toHaveBeenCalled();
});
it("uses account preferences and category for profile-created notifications", async () => {
  await notifyAdminsOfNewProfile({ userId: "new", userName: "New user", email: "new@example.invalid", role: "OPS_MANAGER", createdVia: "Admin" });
  expect(m.preferences).toHaveBeenCalledWith({ userId: "admin", category: "account", channel: "WEB", role: "ADMIN" });
  expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ externalId: "mobile-outbox:pending:account", userId: "admin", channel: "PUSH" }) });
});
it("does not queue profile messages when account preferences disallow the channels", async () => {
  m.preferences.mockResolvedValue(false);
  await notifyAdminsOfNewProfile({ userId: "new", userName: "New user", email: "new@example.invalid", role: "CLEANER", createdVia: "Admin" });
  expect(m.create).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled();
});
it.each(["EN_ROUTE", "EN_ROUTE_UPDATE", "EN_ROUTE_ARRIVED", "JOB_STARTED", "JOB_COMPLETE"] as const)("queues %s using job preferences category", async type => {
  await sendClientJobNotification({ jobId: "job", type });
  expect(m.create).toHaveBeenCalledOnce();
  expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ externalId: "mobile-outbox:pending:jobs", channel: "PUSH", userId: "client", jobId: "job" }) });
  expect(m.email).not.toHaveBeenCalled(); expect(m.sms).not.toHaveBeenCalled();
});
it("does not queue a client job event disabled by its client preference", async () => {
  const job = await m.job(); job.property.client.notificationPref = { notificationsEnabled: true, notifyOnJobComplete: false };
  m.job.mockResolvedValue(job);
  await sendClientJobNotification({ jobId: "job", type: "JOB_COMPLETE" });
  expect(m.create).not.toHaveBeenCalled();
});
