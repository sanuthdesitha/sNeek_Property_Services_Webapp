// @vitest-environment node
/**
 * Day-of reminder (2026-11-17): when one run has several of today's jobs for
 * the same cleaner, the EMAIL is one message listing them all; push and SMS
 * stay one per job. Every job keeps its own cleaner/job/day receipt, claimed
 * before anything is sent. The window (6 AM / 2 hours) is unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Assigned = { user: { id: string; role: string; name: string; email: string | null; phone: string | null } };
const m = vi.hoisted(() => ({
  rows: new Map<string, { status: string; jobId?: string }>(),
  jobs: [] as unknown[],
  send: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek Property Services" }) }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => (/^https?:/.test(path) ? path : `https://app.test${path}`) }));
vi.mock("@/lib/notifications/delivery", () => ({ deliverNotificationToRecipients: m.send }));
vi.mock("@/lib/db", () => ({ db: {
  job: { findMany: async () => m.jobs },
  notification: { findFirst: async () => null },
  appSetting: { create: m.create, update: m.update },
} }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { dispatchCleanerDayReminders } from "@/lib/ops/cleaner-day-reminders";

const jane: Assigned = { user: { id: "jane", role: "CLEANER", name: "Jane", email: "jane@example.invalid", phone: "0400000001" } };
const ravi: Assigned = { user: { id: "ravi", role: "CLEANER", name: "Ravi", email: "ravi@example.invalid", phone: "0400000002" } };
const AT_SIX = new Date("2026-11-18T19:00:00Z"); // 06:00 Sydney on 19 Nov: every job of the day is due

function job(id: string, startTime: string, property: string, people: Assigned[]) {
  return {
    id, jobNumber: `J-${id}`, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-18T13:00:00Z"), startTime, dueTime: null, endTime: null,
    internalNotes: null, property: { name: property, address: `${property} address` }, assignments: people,
  };
}

type DeliveryCall = { recipients: Array<{ id: string }>; jobId: string | null; email: { subject: string; html: string } | null; sms?: string; channels?: Record<string, boolean>; safeguardSubject?: { entityKey: string; relatedEntityKeys: string[] } };
const calls = () => m.send.mock.calls.map(([input]) => input as DeliveryCall);

beforeEach(() => {
  vi.clearAllMocks();
  m.rows.clear();
  m.send.mockResolvedValue(undefined);
  m.create.mockImplementation(async ({ data }: { data: { key: string; value: { status: string; jobId?: string } } }) => {
    if (m.rows.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    m.rows.set(data.key, data.value);
    return data;
  });
  m.update.mockImplementation(async ({ where, data }: { where: { key: string }; data: { value: { status: string } } }) => {
    m.rows.set(where.key, data.value);
    return data;
  });
});

describe("day-of reminder: one email for several of today's jobs", () => {
  it("keeps push and SMS per job and sends one email listing every job in start-time order", async () => {
    m.jobs = [job("a", "08:00", "Bondi Studio", [jane]), job("b", "11:00", "Manly Loft", [jane]), job("c", "14:00", "Coogee Terrace", [jane])];
    const result = await dispatchCleanerDayReminders(AT_SIX);

    const perJob = calls().filter((call) => call.jobId);
    expect(perJob.map((call) => call.jobId)).toEqual(["a", "b", "c"]);
    for (const call of perJob) {
      expect(call.email).toBeNull();
      expect(call.channels).toEqual({ web: true, sms: true });
      expect(call.sms).toContain("you're cleaning");
    }
    const combined = calls().filter((call) => !call.jobId);
    expect(combined).toHaveLength(1);
    expect(combined[0].channels).toEqual({ email: true });
    expect(combined[0].email!.subject).toBe("Your 3 jobs today (Thu 19 Nov)");
    const html = combined[0].email!.html;
    expect(html.indexOf("Bondi Studio")).toBeLessThan(html.indexOf("Manly Loft"));
    expect(html.indexOf("Manly Loft")).toBeLessThan(html.indexOf("Coogee Terrace"));
    expect(html).toContain("https://app.test/cleaner/jobs/a");
    expect(combined[0].safeguardSubject).toEqual({ entityKey: expect.stringMatching(/^JobReminderBatch:/), relatedEntityKeys: ["Job:a", "Job:b", "Job:c"] });

    expect(result).toMatchObject({ jobs: 3, sent: 3, skipped: 0 });
    expect([...m.rows.values()].map((row) => row.status)).toEqual(["ATTEMPTED", "ATTEMPTED", "ATTEMPTED"]);
  });

  it("keeps a single job exactly as before (its own push, email and SMS)", async () => {
    m.jobs = [job("a", "08:00", "Bondi Studio", [jane])];
    await dispatchCleanerDayReminders(AT_SIX);
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ jobId: "a", email: { subject: "Today's job: Bondi Studio (J-a)" } });
    expect(calls()[0].channels).toBeUndefined();
  });

  it("gives each cleaner their own email; a cleaner with one job keeps the single reminder", async () => {
    m.jobs = [job("a", "08:00", "Bondi Studio", [jane, ravi]), job("b", "11:00", "Manly Loft", [jane])];
    await dispatchCleanerDayReminders(AT_SIX);
    const forRavi = calls().filter((call) => call.recipients[0].id === "ravi");
    expect(forRavi).toHaveLength(1);
    expect(forRavi[0]).toMatchObject({ jobId: "a", email: { subject: "Today's job: Bondi Studio (J-a)" } });
    const janeEmails = calls().filter((call) => call.recipients[0].id === "jane" && call.email);
    expect(janeEmails).toHaveLength(1);
    expect(janeEmails[0].safeguardSubject!.relatedEntityKeys).toEqual(["Job:a", "Job:b"]);
  });

  it("sends once across concurrent runs and never lists a job again", async () => {
    m.jobs = [job("a", "08:00", "Bondi Studio", [jane]), job("b", "11:00", "Manly Loft", [jane])];
    await Promise.all([dispatchCleanerDayReminders(AT_SIX), dispatchCleanerDayReminders(AT_SIX)]);
    await dispatchCleanerDayReminders(new Date(AT_SIX.getTime() + 30 * 60_000));
    expect(calls().filter((call) => call.email)).toHaveLength(1);
    expect(calls().filter((call) => call.jobId)).toHaveLength(2);
    expect(m.rows.size).toBe(2);
  });

  it("lists only the jobs still to be reminded when one went out earlier", async () => {
    m.jobs = [job("early", "07:00", "Glebe House", [jane]), job("a", "10:00", "Bondi Studio", [jane]), job("b", "12:00", "Manly Loft", [jane])];
    // 05:00: only the 07:00 job is inside the 2-hour lead, so it goes out alone.
    await dispatchCleanerDayReminders(new Date("2026-11-18T18:00:00Z"));
    expect(calls()).toHaveLength(1);
    expect(calls()[0].jobId).toBe("early");
    m.send.mockClear();
    await dispatchCleanerDayReminders(AT_SIX);
    const combined = calls().filter((call) => !call.jobId);
    expect(combined).toHaveLength(1);
    expect(combined[0].safeguardSubject!.relatedEntityKeys).toEqual(["Job:a", "Job:b"]);
    expect(combined[0].email!.html).not.toContain("Glebe House");
  });

  it("keeps every receipt uncertain (not retried) when a send throws part-way", async () => {
    m.jobs = [job("a", "08:00", "Bondi Studio", [jane]), job("b", "11:00", "Manly Loft", [jane])];
    m.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("provider outcome unknown"));
    await expect(dispatchCleanerDayReminders(AT_SIX)).rejects.toThrow("provider outcome unknown");
    expect([...m.rows.values()].map((row) => row.status)).toEqual(["UNCERTAIN", "UNCERTAIN"]);
    m.send.mockClear();
    await dispatchCleanerDayReminders(AT_SIX);
    expect(m.send).not.toHaveBeenCalled();
  });
});
