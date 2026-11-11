// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ users: vi.fn(), task: vi.fn(), job: vi.fn(), audit: vi.fn(), office: vi.fn(), setting: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  user: { findMany: m.users }, laundryTask: { findUnique: m.task }, job: { findUnique: m.job },
  auditLog: { create: m.audit }, appSetting: { findUnique: m.setting },
} }));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: m.office }));

import { sendClientDelayNotice, sendLaundryCleanerNudge, sendStaffMessage, OfficeActionError } from "@/lib/notifications/office-actions";

beforeEach(() => {
  vi.resetAllMocks();
  m.setting.mockResolvedValue(null);
  m.office.mockResolvedValue([]);
});

describe("message to selected staff", () => {
  it("sends only to active staff and refuses clients, inactive and unknown accounts with a reason", async () => {
    m.users.mockResolvedValue([
      { id: "c1", role: "CLEANER", name: "Ana", email: "a@x.invalid", isActive: true },
      { id: "cl", role: "CLIENT", name: "Client", email: "c@x.invalid", isActive: true },
      { id: "old", role: "CLEANER", name: "Old", email: null, isActive: false },
    ]);
    const result = await sendStaffMessage("admin-1", { recipientIds: ["c1", "cl", "old", "ghost"], subject: "Roster", body: "New roster is up", transports: ["PUSH"] });
    expect(m.office.mock.calls[0][0]).toMatchObject({ scopeType: "STAFF_MEMBER", eventKey: "office.staff_message", transports: ["PUSH"], respectsPreferences: false, recipients: [{ id: "c1" }] });
    expect(result.refused.map((row) => row.id)).toEqual(["cl", "old", "ghost"]);
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ action: "OFFICE_STAFF_MESSAGE_SENT", userId: "admin-1" });
  });

  it("requires an explicit transport", async () => {
    await expect(sendStaffMessage("admin-1", { recipientIds: ["c1"], subject: "x", body: "y", transports: [] })).rejects.toThrow();
    expect(m.office).not.toHaveBeenCalled();
  });
});

describe("laundry nudge", () => {
  it("addresses the cleaners assigned to the task's job through the laundry-task scope", async () => {
    m.task.mockResolvedValue({ id: "t1", jobId: "j1", job: { jobNumber: "J-1", property: { name: "Bondi" }, assignments: [{ user: { id: "c1", role: "CLEANER", name: "Ana", email: null, isActive: true } }] } });
    await sendLaundryCleanerNudge("ops-1", { laundryTaskId: "t1", kind: "REQUEST_PHOTO", transports: ["PUSH"] });
    const call = m.office.mock.calls[0][0];
    expect(call).toMatchObject({ scopeType: "LAUNDRY_TASK_CLEANER", category: "laundry", subject: "Laundry photo requested", recipients: [{ id: "c1" }] });
    expect(call.scopeId()).toBe("t1");
  });

  it("refuses a task with nobody assigned", async () => {
    m.task.mockResolvedValue({ id: "t1", jobId: "j1", job: { jobNumber: null, property: null, assignments: [] } });
    await expect(sendLaundryCleanerNudge("ops-1", { laundryTaskId: "t1", kind: "ASK_CLEANER", transports: ["PUSH"] })).rejects.toBeInstanceOf(OfficeActionError);
  });
});

describe("client delay notice", () => {
  const job = (enabled: boolean | null) => ({ id: "j1", jobNumber: "J-1", property: { name: "Bondi", client: { id: "cl", notificationPref: enabled === null ? null : { notificationsEnabled: enabled }, users: [{ id: "u1", role: "CLIENT", name: "Jo", email: "jo@x.invalid", isActive: true }] } } });
  it("sends to the client's logins through the job-client scope", async () => {
    m.job.mockResolvedValue(job(null));
    await sendClientDelayNotice("admin-1", { jobId: "j1", etaMinutes: 30, transports: ["PUSH", "EMAIL"] });
    expect(m.office.mock.calls[0][0]).toMatchObject({ scopeType: "JOB_CLIENT_CONTACT", eventKey: "client.delay_notice", body: expect.stringContaining("about 30 minutes") });
  });
  it("honours a client who switched job notifications off", async () => {
    m.job.mockResolvedValue(job(false));
    await expect(sendClientDelayNotice("admin-1", { jobId: "j1", transports: ["PUSH"] })).rejects.toMatchObject({ status: 409 });
    expect(m.office).not.toHaveBeenCalled();
  });
});
