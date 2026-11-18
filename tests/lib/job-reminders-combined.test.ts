// @vitest-environment node
/**
 * Owner, 2026-11-17: "For cleaners, send the upcoming jobs reminder as ONE
 * email, not separate emails for each job." The 24-hour reminder run now
 * sends one email per cleaner listing every job of theirs that this run
 * claimed. When it fires is unchanged; the per-job flag (reminder24hSent) is
 * still the exactly-once marker for every job the email covers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serializeJobInternalNotes } from "@/lib/jobs/meta";

type Flag = "reminder24hSent" | "reminder2hSent";
type Person = { name: string; email: string | null; phone: string | null };
type JobRow = {
  id: string; jobNumber: string; jobType: string; scheduledDate: Date; startTime: string; dueTime: null; endTime: null;
  internalNotes: string | null; reminder24hSent: boolean; reminder2hSent: boolean;
  property: { name: string; address: string }; assignments: Array<{ user: Person }>;
};

const m = vi.hoisted(() => ({
  jobs: [] as JobRow[],
  email: vi.fn(),
  sms: vi.fn(),
  template: vi.fn(),
  lifecycle: vi.fn(async () => undefined),
  subjectOverride: null as string | null,
}));

vi.mock("@/lib/db", () => {
  const flagsOf = (where: Record<string, unknown>) =>
    Object.entries(where).filter(([key]) => key === "reminder24hSent" || key === "reminder2hSent") as Array<[Flag, boolean]>;
  return {
    db: {
      job: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          m.jobs.filter((job) => flagsOf(where).every(([key, value]) => job[key] === value)).map((job) => structuredClone(job))),
        findFirst: vi.fn(async () => null),
        updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown> & { id: string }; data: Partial<Record<Flag, boolean>> }) => {
          const job = m.jobs.find((item) => item.id === where.id);
          if (!job || !flagsOf(where).every(([key, value]) => job[key] === value)) return { count: 0 };
          Object.assign(job, data);
          return { count: 1 };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Record<Flag, boolean>> }) => Object.assign(m.jobs.find((job) => job.id === where.id)!, data)),
      },
    },
  };
});
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({
  companyName: "sNeek Property Services", timezone: "Australia/Sydney", reminder24hHours: 24, reminder2hHours: 2,
  scheduledNotifications: { reminder24hEnabled: true, reminder2hEnabled: true },
}) }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => (/^https?:/.test(path) ? path : `https://app.test${path}`) }));
vi.mock("@/lib/email-templates", () => ({ renderEmailTemplate: m.template }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/lifecycle", () => ({ sendLifecycleEmail: m.lifecycle }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/notifications/wording/render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/wording/render")>();
  return {
    ...actual,
    // The defaults, with an optional saved subject override (as the wording store would supply).
    loadNotificationWording: async (typeKey: string) => {
      const defaults = actual.defaultNotificationWording(typeKey);
      return {
        ...defaults,
        line: (partId: string, transport: "INBOX" | "EMAIL" | "SMS" | "PUSH", values: Record<string, unknown>, when?: boolean) =>
          partId === "digest-subject" && m.subjectOverride
            ? m.subjectOverride.replace("{{jobCount}}", String(values.jobCount))
            : defaults.line(partId, transport, values as never, when),
      };
    },
  };
});

import { dispatchJobReminders } from "@/lib/ops/reminders";

const NOW = new Date("2026-11-18T00:00:00Z"); // 11:00 Sydney; every job below is tomorrow, inside the 24-hour window
const jane: Person = { name: "Jane", email: "jane@example.invalid", phone: "0400000001" };
const ravi: Person = { name: "Ravi", email: "ravi@example.invalid", phone: "0400000002" };
const timing = serializeJobInternalNotes({ lateCheckout: { enabled: true, preset: "11:00" }, earlyCheckin: { enabled: true, preset: "custom", time: "14:00" } });

function job(id: string, startTime: string, utcStart: string, property: string, people: Person[], internalNotes: string | null = null): JobRow {
  return {
    id, jobNumber: `J-${id}`, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date(utcStart), startTime, dueTime: null, endTime: null,
    internalNotes, reminder24hSent: false, reminder2hSent: false,
    property: { name: property, address: `${property} address` }, assignments: people.map((user) => ({ user })),
  };
}

/** Three jobs tomorrow for Jane, listed out of order (scheduledDate is the calendar day, the start time orders them). */
function threeJobsForJane(): JobRow[] {
  return [
    job("c", "10:45", "2026-11-18T13:00:00Z", "Coogee Terrace", [jane]),
    job("a", "08:00", "2026-11-18T13:00:00Z", "Bondi Studio", [jane], timing),
    job("b", "09:30", "2026-11-18T13:00:00Z", "Manly <Loft>", [jane]),
  ];
}

const accepted = { ok: true, acceptance: "ACCEPTED", externalId: "provider-1" };
const flags = () => Object.fromEntries(m.jobs.map((item) => [item.id, item.reminder24hSent]));

beforeEach(() => {
  m.jobs = [];
  m.subjectOverride = null;
  m.email.mockReset().mockResolvedValue(accepted);
  m.sms.mockReset().mockResolvedValue({ ok: true, status: "sent" });
  m.lifecycle.mockClear();
  m.template.mockReset().mockImplementation((_settings: unknown, key: string, values: Record<string, string>) => ({
    subject: `Tomorrow: ${values.propertyName} (${values.jobNumber})`, html: `<p>${key} ${values.propertyName}</p>`,
  }));
});

describe("24-hour reminder: one email per cleaner", () => {
  it("sends one email listing three jobs in date and start-time order, with timing lines and links", async () => {
    m.jobs = threeJobsForJane();
    const summary = await dispatchJobReminders({ now: NOW, reminderType: "LONG" });

    expect(m.email).toHaveBeenCalledTimes(1);
    const payload = m.email.mock.calls[0][0];
    expect(payload).toMatchObject({ kind: "job_reminder", to: "jane@example.invalid", subject: "Your 3 upcoming jobs (Thu 19 Nov)" });
    const html: string = payload.html;
    const order = ["Bondi Studio", "Manly &lt;Loft&gt;", "Coogee Terrace"].map((name) => html.indexOf(name));
    expect(order.every((index) => index > 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(html).not.toContain("Manly <Loft>");
    expect(html).toContain("Late checkout: start after 11:00");
    expect(html).toContain("Early check-in: complete before 14:00");
    for (const id of ["a", "b", "c"]) expect(html).toContain(`https://app.test/cleaner/jobs/${id}`);
    expect(html).toContain("Thu 19 Nov · 08:00");
    expect(m.template).not.toHaveBeenCalled();

    // One message at the gate: the type kept, one batch subject, every job as a related subject.
    expect(payload.safeguard).toEqual({
      typeKey: "job.reminder.scheduled",
      entityKey: expect.stringMatching(/^JobReminderBatch:[0-9a-f]{24}$/),
      relatedEntityKeys: ["Job:a", "Job:b", "Job:c"],
    });

    expect(flags()).toEqual({ a: true, b: true, c: true });
    expect(summary.longSent).toBe(3);
    expect(m.lifecycle).toHaveBeenCalledTimes(3); // the client's reminder stays one per job
    const emailRows = summary.recipients.filter((row) => row.channel === "email");
    expect(emailRows.map((row) => row.jobId)).toEqual(["a", "b", "c"]);
    expect(new Set(emailRows.map((row) => row.combinedEmail?.id)).size).toBe(1);
    expect(emailRows[0].combinedEmail).toMatchObject({ jobCount: 3, jobNumbers: ["J-a", "J-b", "J-c"] });
  });

  it("gives each cleaner on a shared job their own email", async () => {
    m.jobs = [job("a", "08:00", "2026-11-18T13:00:00Z", "Bondi Studio", [jane, ravi]), job("b", "10:30", "2026-11-18T13:00:00Z", "Manly Loft", [jane])];
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });

    expect(m.email).toHaveBeenCalledTimes(2);
    const toJane = m.email.mock.calls.find(([payload]) => payload.to === jane.email)![0];
    const toRavi = m.email.mock.calls.find(([payload]) => payload.to === ravi.email)![0];
    expect(toJane.subject).toBe("Your 2 upcoming jobs (Thu 19 Nov)");
    expect(toJane.safeguard.relatedEntityKeys).toEqual(["Job:a", "Job:b"]);
    // Ravi has one job: that job's usual reminder, under the job itself.
    expect(toRavi).toMatchObject({ subject: "Tomorrow: Bondi Studio (J-a)", safeguard: { typeKey: "job.reminder.scheduled", entityKey: "Job:a" } });
    expect(flags()).toEqual({ a: true, b: true });
  });

  it("sends a cleaner with one job that job's usual reminder email", async () => {
    m.jobs = [job("a", "08:00", "2026-11-18T13:00:00Z", "Bondi Studio", [jane], timing)];
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    expect(m.email).toHaveBeenCalledTimes(1);
    expect(m.template).toHaveBeenCalledWith(expect.anything(), "jobReminder24h", expect.objectContaining({
      propertyName: "Bondi Studio", jobNumber: "J-a", timingFlags: "Late checkout: start after 11:00 | Early check-in: complete before 14:00",
    }));
    expect(m.email.mock.calls[0][0].safeguard).toEqual({ typeKey: "job.reminder.scheduled", entityKey: "Job:a" });
  });

  it("marks none when the email reached no provider, and the next run sends one email with all of them", async () => {
    m.jobs = threeJobsForJane();
    m.email.mockResolvedValueOnce({ ok: false, skipped: true, error: "auto-email-disabled" });
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    expect(flags()).toEqual({ a: false, b: false, c: false });
    expect(m.lifecycle).not.toHaveBeenCalled();

    await dispatchJobReminders({ now: new Date(NOW.getTime() + 30 * 60_000), reminderType: "LONG" });
    expect(m.email).toHaveBeenCalledTimes(2);
    expect(m.email.mock.calls[1][0].safeguard.relatedEntityKeys).toEqual(["Job:a", "Job:b", "Job:c"]);
    expect(flags()).toEqual({ a: true, b: true, c: true });
  });

  it("marks every listed job once the email is accepted, and the next run sends nothing", async () => {
    m.jobs = threeJobsForJane();
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    await dispatchJobReminders({ now: new Date(NOW.getTime() + 30 * 60_000), reminderType: "LONG" });
    await dispatchJobReminders({ now: new Date(NOW.getTime() + 60 * 60_000), reminderType: "LONG" });
    expect(m.email).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain or safeguard-held email marked (never sent twice)", async () => {
    m.jobs = threeJobsForJane();
    m.email.mockResolvedValue({ ok: false, skipped: true, acceptance: "NOT_ACCEPTED", suppressed: { reason: "PAUSED_SUBJECT", held: false } });
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    await dispatchJobReminders({ now: new Date(NOW.getTime() + 30 * 60_000), reminderType: "LONG" });
    expect(m.email).toHaveBeenCalledTimes(1);
    expect(flags()).toEqual({ a: true, b: true, c: true });
  });

  it("does not list a job already reminded in a later combined email", async () => {
    m.jobs = threeJobsForJane();
    m.jobs[0].reminder24hSent = true; // Coogee was reminded earlier
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    expect(m.email.mock.calls[0][0].safeguard.relatedEntityKeys).toEqual(["Job:a", "Job:b"]);
    expect(m.email.mock.calls[0][0].html).not.toContain("Coogee Terrace");
  });

  it("sends once across two concurrent runs", async () => {
    m.jobs = threeJobsForJane();
    await Promise.all([dispatchJobReminders({ now: NOW, reminderType: "LONG" }), dispatchJobReminders({ now: NOW, reminderType: "LONG" })]);
    const listed = m.email.mock.calls.flatMap(([payload]) => payload.safeguard.relatedEntityKeys ?? [payload.safeguard.entityKey]);
    expect(listed.sort()).toEqual(["Job:a", "Job:b", "Job:c"]);
    expect(m.email).toHaveBeenCalledTimes(1);
  });

  it("uses the office's saved wording for the combined email", async () => {
    m.jobs = threeJobsForJane();
    m.subjectOverride = "Heads up: {{jobCount}} jobs coming";
    await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    expect(m.email.mock.calls[0][0].subject).toBe("Heads up: 3 jobs coming");
  });

  it("reports a cleaner without an email per job and emails the rest", async () => {
    m.jobs = [job("a", "08:00", "2026-11-18T13:00:00Z", "Bondi Studio", [jane, { name: "No Mail", email: null, phone: null }])];
    const summary = await dispatchJobReminders({ now: NOW, reminderType: "LONG" });
    expect(summary.recipients).toEqual(expect.arrayContaining([expect.objectContaining({ recipient: "No Mail", status: "skipped", error: "No email on file" })]));
    expect(m.email).toHaveBeenCalledTimes(1);
  });
});

describe("2-hour reminder SMS stays one per job", () => {
  it("texts each job separately", async () => {
    m.jobs = [
      job("a", "10:00", "2026-11-18T13:00:00Z", "Bondi Studio", [jane]),
      job("b", "10:30", "2026-11-18T13:00:00Z", "Manly Loft", [jane]),
    ];
    const close = new Date("2026-11-18T22:30:00Z"); // 09:30 Sydney on 19 Nov
    await dispatchJobReminders({ now: close, reminderType: "SHORT" });
    expect(m.sms).toHaveBeenCalledTimes(2);
    expect(m.sms.mock.calls.map(([, , , safeguard]) => safeguard.entityKey)).toEqual(["Job:a", "Job:b"]);
    expect(m.email).not.toHaveBeenCalled();
  });
});
