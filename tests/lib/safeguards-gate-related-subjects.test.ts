// @vitest-environment node
/**
 * Combined reminder emails (2026-11-17) list several jobs in ONE message. The
 * gate sees that message once (one decision, one event row, one count against
 * the person's caps) under its own batch subject, and still treats every job
 * it covers as a subject: a pause on any job stops it, and the same type
 * about any of those jobs sent recently counts as the same subject. Quiet
 * hours and the hourly cap apply exactly as to any other email.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SAFEGUARD_SETTINGS } from "@/lib/notifications/safeguards/config";

type Where = Record<string, unknown>;

const m = vi.hoisted(() => ({
  pauses: [] as Array<{ scopeKind: string }>,
  incidentWhere: [] as Where[],
  countWhere: [] as Where[],
  counts: { duplicate: 0, sameSubject: 0, hour: 0, day: 0 },
  created: [] as Array<Record<string, unknown>>,
  settings: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/notifications/safeguards/store", () => ({ readSafeguardSettings: async () => m.settings }));
vi.mock("@/lib/notifications/safeguards/breaker", () => ({ evaluateBreaker: async () => undefined }));
vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: async () => 1,
    outboundSafeguardIncident: {
      findMany: async ({ where }: { where: Where }) => {
        m.incidentWhere.push(where);
        return m.pauses;
      },
    },
    outboundMessageEvent: {
      count: async ({ where }: { where: Where }) => {
        m.countWhere.push(where);
        if ("contentHash" in where) return m.counts.duplicate;
        if ("typeKey" in where) return m.counts.sameSubject;
        // The hourly count is asked before the daily one.
        const ceilingCalls = m.countWhere.filter((item) => !("contentHash" in item) && !("typeKey" in item)).length;
        return ceilingCalls === 1 ? m.counts.hour : m.counts.day;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        m.created.push(data);
        return { id: `event-${m.created.length}` };
      },
    },
  };
  return {
    db: {
      user: {
        findUnique: async () => ({ id: "cleaner-1", role: "CLEANER", isActive: true }),
        findFirst: async () => ({ id: "cleaner-1", role: "CLEANER", isActive: true }),
      },
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
    },
  };
});

import { guardOutbound } from "@/lib/notifications/safeguards/gate";

const DAYTIME = new Date("2026-11-18T01:00:00Z"); // 12:00 Sydney
const NIGHT = new Date("2026-11-18T12:00:00Z"); // 23:00 Sydney

function combinedRequest(typeKey = "job.reminder.scheduled") {
  return {
    transport: "EMAIL" as const,
    recipient: "jane@example.invalid",
    meta: {
      typeKey,
      entityKey: "JobReminderBatch:abc",
      relatedEntityKeys: ["Job:a", "Job:b", "Job:c"],
      recipientUserId: "cleaner-1",
    },
    subject: "Your 3 upcoming jobs",
    content: "<p>three jobs</p>",
    holdPayload: { transport: "EMAIL" as const, to: "jane@example.invalid", subject: "Your 3 upcoming jobs", html: "<p>three jobs</p>" },
  };
}

beforeEach(() => {
  m.pauses = [];
  m.incidentWhere = [];
  m.countWhere = [];
  m.counts = { duplicate: 0, sameSubject: 0, hour: 0, day: 0 };
  m.created = [];
  m.settings = structuredClone(DEFAULT_SAFEGUARD_SETTINGS);
});

describe("one combined email at the sending gate", () => {
  it("is one decision and one event under the batch subject, checking every job it covers", async () => {
    const result = await guardOutbound(combinedRequest(), DAYTIME);
    expect(result.allowed).toBe(true);
    expect(m.created).toHaveLength(1);
    expect(m.created[0]).toMatchObject({ transport: "EMAIL", typeKey: "job.reminder.scheduled", entityKey: "JobReminderBatch:abc", decision: "ALLOWED" });
    const pauseScopes = (m.incidentWhere[0].OR as Array<{ scopeKind: string; scopeKey: string }>).filter((scope) => scope.scopeKind === "SUBJECT").map((scope) => scope.scopeKey);
    expect(pauseScopes).toEqual(["JobReminderBatch:abc", "Job:a", "Job:b", "Job:c"]);
    const sameSubject = m.countWhere.find((where) => "typeKey" in where)!;
    expect(sameSubject.entityKey).toEqual({ in: ["JobReminderBatch:abc", "Job:a", "Job:b", "Job:c"] });
  });

  it("is stopped by a pause on any one of its jobs", async () => {
    m.pauses = [{ scopeKind: "SUBJECT" }];
    const result = await guardOutbound(combinedRequest(), DAYTIME);
    expect(result).toMatchObject({ allowed: false, reason: "PAUSED_SUBJECT" });
  });

  it("counts a recent reminder about one of its jobs as the same subject (normal-class type)", async () => {
    m.counts.sameSubject = 1;
    const result = await guardOutbound(combinedRequest("job.reminder.manual"), DAYTIME);
    expect(result).toMatchObject({ allowed: false, reason: "SAME_SUBJECT" });
  });

  it("still meets the hourly cap as one more email to that person", async () => {
    m.counts.hour = DEFAULT_SAFEGUARD_SETTINGS.limits.EMAIL.perHour;
    const result = await guardOutbound(combinedRequest(), DAYTIME);
    expect(result).toMatchObject({ allowed: false, reason: "CAPPED_HOURLY" });
  });

  it("meets quiet hours exactly as its type always did", async () => {
    // job.reminder.manual is dropped at night (the inbox copy remains).
    expect(await guardOutbound(combinedRequest("job.reminder.manual"), NIGHT)).toMatchObject({ allowed: false, reason: "QUIET_HOURS", held: false });
    // The 24-hour and day-of reminders are urgent: quiet hours never applied to them.
    expect(await guardOutbound(combinedRequest("job.reminder.scheduled"), NIGHT)).toMatchObject({ allowed: true });
    expect(await guardOutbound(combinedRequest("job.cleaner_day_reminder"), NIGHT)).toMatchObject({ allowed: true });
  });

  it("keeps a single-job message exactly as before (one subject, no list)", async () => {
    const request = { ...combinedRequest(), meta: { typeKey: "job.reminder.scheduled", entityKey: "Job:a", recipientUserId: "cleaner-1" } };
    await guardOutbound(request, DAYTIME);
    const sameSubject = m.countWhere.find((where) => "typeKey" in where)!;
    expect(sameSubject.entityKey).toBe("Job:a");
    const pauseScopes = (m.incidentWhere[0].OR as Array<{ scopeKind: string; scopeKey: string }>).filter((scope) => scope.scopeKind === "SUBJECT");
    expect(pauseScopes).toEqual([{ scopeKind: "SUBJECT", scopeKey: "Job:a" }]);
  });
});
