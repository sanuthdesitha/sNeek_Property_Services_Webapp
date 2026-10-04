// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { autoPauseStaleJobs } from "@/lib/ops/auto-pause";
import { dispatchUnfinishedJobPushReminders } from "@/lib/ops/unfinished-reminders";
import { runSlaEscalation } from "@/lib/ops/sla";
import { sendAdminAttentionSummary } from "@/lib/ops/admin-attention-summary";
import { dispatchTomorrowPrepSummaries } from "@/lib/ops/tomorrow-prep";
const m = vi.hoisted(() => ({ jobs: vi.fn(), users: vi.fn(), recent: vi.fn(), audit: vi.fn(), create: vi.fn(), many: vi.fn(), settings: vi.fn(), pause: vi.fn(), close: vi.fn(), push: vi.fn(), state: vi.fn(), summary: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  job: { findMany: m.jobs, updateMany: m.pause }, user: { findMany: m.users }, timeLog: { update: m.close },
  auditLog: { findMany: m.recent, create: m.audit }, notification: { create: m.create, createMany: m.many },
  appSetting: { findUnique: m.state, upsert: vi.fn() }, laundryTask: { findMany: async () => [] },
} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: m.settings }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: vi.fn(() => { throw new Error("Unexpected email"); }) }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: vi.fn(() => { throw new Error("Unexpected SMS"); }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/dashboard/immediate-attention", () => ({ getAdminAttentionSummary: m.summary }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: () => ({ subject: "Summary", html: "<p>Summary</p>" }) }));
vi.mock("@/lib/notification-templates", () => ({ renderNotificationTemplate: () => ({ webSubject: "Summary", webBody: "Review summary", smsBody: "Summary" }) }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => path }));
vi.mock("@/lib/cases/auto-case", () => ({ autoResolveJobCases: vi.fn(), findOpenAutoCase: vi.fn(), meetsAutoOpenThreshold: () => false, overdueCaseThresholdMinutes: () => 60 }));
const now = new Date("2026-10-03T08:00:00Z");
beforeEach(() => {
  vi.clearAllMocks(); m.recent.mockResolvedValue([]); m.audit.mockResolvedValue({}); m.state.mockResolvedValue(null); m.pause.mockResolvedValue({ count: 1 });
  m.users.mockResolvedValue([{ id: "admin", role: "ADMIN", name: "Admin", email: null, phone: null }]);
  m.jobs.mockResolvedValue([{ id: "job", jobNumber: "J1", status: "IN_PROGRESS", property: { name: "House", suburb: "Town" }, assignments: [{ userId: "cleaner" }],
    timeLogs: [{ id: "clock", userId: "cleaner", startedAt: new Date("2026-10-01"), stoppedAt: null }], scheduledDate: new Date("2026-10-02"), dueTime: "09:00", issueTickets: [] }]);
  m.settings.mockResolvedValue({ timezone: "Australia/Sydney", companyName: "Company", sla: { enabled: true, overdueEscalationMinutes: 60, createIssueOnOverdue: false, notifyAdminOnOverdue: true }, caseAutomation: { autoResolveOnClear: false }, scheduledNotifications: { adminAttentionSummaryEnabled: true, tomorrowPrepEnabled: true } });
  m.summary.mockResolvedValue(Object.fromEntries(["attentionCount", "pendingPayRequests", "pendingTimeAdjustments", "pendingClientTaskRequests", "pendingContinuations", "pendingClientApprovals", "pendingLaundryRescheduleDraft", "pendingQaOutcomes", "unassignedJobs", "openCases", "overdueCases", "highCases", "newCases", "flaggedLaundry"].map(key => [key, 1])));
});
const expectMarker = (category: string, userId: string) => expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId, channel: "PUSH", externalId: `mobile-outbox:pending:${category}`, status: "SENT" }) });
it("queues an auto-pause jobs notification for the assigned cleaner after closing the stale clock", async () => {
  expect(await autoPauseStaleJobs(now)).toEqual({ paused: 1 });
  expectMarker("jobs", "cleaner"); expect(m.close).toHaveBeenCalledOnce();
  expect(m.pause).toHaveBeenCalledWith({ where: { id: "job", status: "IN_PROGRESS" }, data: { status: "PAUSED" } });
});
it("does not emit auto-pause notification for a recent clock", async () => {
  const jobs = await m.jobs(); jobs[0].timeLogs[0].startedAt = now; m.jobs.mockResolvedValue(jobs);
  expect(await autoPauseStaleJobs(now)).toEqual({ paused: 0 }); expect(m.create).not.toHaveBeenCalled();
});
it("queues unfinished reminders with jobs category and preserves the assignment recipient", async () => {
  expect(await dispatchUnfinishedJobPushReminders(now)).toEqual({ reminded: 1, skipped: 0 });
  expectMarker("jobs", "cleaner"); expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "JOB_UNFINISHED_PUSH_REMINDER" }) });
});
it("does not queue another unfinished reminder after the audit dedup match", async () => {
  m.recent.mockResolvedValue([{ jobId: "job" }]);
  expect(await dispatchUnfinishedJobPushReminders(now)).toEqual({ reminded: 0, skipped: 1 }); expect(m.create).not.toHaveBeenCalled();
});
it("queues SLA escalation to active admins with jobs category", async () => {
  expect(await runSlaEscalation(now)).toMatchObject({ escalated: 1 });
  expect(m.many).toHaveBeenCalledWith({ skipDuplicates: true, data: [expect.objectContaining({ userId: "admin", jobId: "job", externalId: "mobile-outbox:pending:jobs", channel: "PUSH" })] });
});
it("does not queue another SLA escalation after today's audit", async () => {
  m.recent.mockResolvedValue([{ jobId: "job", action: "SLA_ESCALATE" }]);
  await runSlaEscalation(now); expect(m.many).not.toHaveBeenCalled();
});
it("queues administrator attention summaries under account category", async () => {
  await sendAdminAttentionSummary({ now, ignoreWindow: true }); expectMarker("account", "admin");
});
it("queues tomorrow-prep recipient summaries under jobs category", async () => {
  m.jobs.mockResolvedValue([]);
  m.users.mockResolvedValueOnce([{ id: "cleaner", role: "CLEANER", name: "Cleaner", email: null, phone: null }]).mockResolvedValueOnce([]);
  await dispatchTomorrowPrepSummaries(now, { ignoreWindow: true }); expectMarker("jobs", "cleaner");
});
