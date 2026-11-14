// @vitest-environment node
/**
 * System health (board "Diagnostics", 2026-11-16): the summary is built only
 * from what was read; a silent worker makes scheduled work "Cannot tell from
 * here"; "Key present" is never "Working"; nothing unknown becomes zero or
 * success; "Copy details for support" carries no secret, token or client data.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSystemHealthView, unreadableAreas, plainFailure } from "@/lib/ops/system-health-model";
import { describeCron, nextCronRun, previousCronRun } from "@/lib/ops/cron-schedule";
import { SCHEDULED_TASK_NAMES, scheduledTaskInfo } from "@/lib/ops/scheduled-tasks";
import { redactSupportText } from "@/lib/ops/support-redaction";
import type { HealthFacts, TaskFacts } from "@/lib/ops/system-health-types";

const NOW = "2026-11-16T03:06:00.000Z"; // 14:06 Sydney (AEDT)

function task(overrides: Partial<TaskFacts> & { name: string }): TaskFacts {
  return {
    cron: "*/30 * * * *",
    timeZone: "Australia/Sydney",
    lastRun: { at: "2026-11-16T03:00:00.000Z", ok: true, durationMs: 1200, error: null, skipped: false },
    lastFailure: null,
    ok24h: 47,
    failed24h: 0,
    unknown24h: 0,
    failuresInARow: 0,
    ...overrides,
  };
}

function facts(overrides: Partial<HealthFacts> = {}): HealthFacts {
  return {
    checkedAt: NOW,
    timeZone: "Australia/Sydney",
    worker: { status: "ACTIVE", lastSeenAt: "2026-11-16T03:05:30.000Z", registeredJobs: ["ical-sync"] },
    tasks: [task({ name: "ical-sync", cron: "0 * * * *", lastRun: { at: "2026-11-16T03:00:03.000Z", ok: true, durationMs: 3200, error: null, skipped: false } })],
    queue: { waiting: 4, running: 1, willRetry: 0, failed24h: 0, doneLastHour: 63, stuck: 0 },
    database: { reachable: true, runningQueries: 2, longestSeconds: 0, activeQueries: [] },
    xero: { readable: true, notConnected: false, state: "connected", tenantName: "Harbour Holdings Pty Ltd", lastRefreshedAt: "2026-11-15T16:47:00.000Z", renewBy: "2027-01-14T16:47:00.000Z", reason: null, lastSyncAt: null },
    safeguards: { readable: true, emergencyStop: false, paused: [] },
    email: { keyPresent: true, providerName: "Resend", handedOver24h: 214, failed24h: 0, notSent24h: 0, pending24h: 0, lastHandedOverAt: "2026-11-16T03:01:00.000Z", lastFailureAt: null, bounceList: 3 },
    sms: { keyPresent: true, providerName: "cellcast", handedOver24h: 12, failed24h: 0, notSent24h: 0, pending24h: 0, lastHandedOverAt: "2026-11-16T02:00:00.000Z", lastFailureAt: null },
    push: { keyPresent: true, providerName: "Browser push and phone app", handedOver24h: 96, failed24h: 0, notSent24h: 0, pending24h: 0, lastHandedOverAt: "2026-11-16T03:01:00.000Z", lastFailureAt: null, browsers: 18 },
    storage: { keyPresent: true, lastUploadAt: "2026-11-16T03:04:00.000Z", unresolvedFailures: 0, oldestUnresolvedAt: null },
    maps: { keyPresent: true },
    ai: { readable: true, okCalls24h: 41, failedCalls24h: 0, lastOkAt: "2026-11-15T22:12:00.000Z", lastOkProvider: "ollama", lastOkLatencyMs: 1800, lastFailureAt: null },
    ical: { readable: true, enabledFeeds: 14, failing: [], lastRunAt: "2026-11-16T03:00:00.000Z" },
    payments: { readable: true, activeGateways: [] },
    server: { uptimeSeconds: 6 * 86_400 + 4 * 3600, rssMB: 412, totalMemMB: 2048 },
    ...overrides,
  };
}

const area = (view: ReturnType<typeof buildSystemHealthView>, key: string) => view.areas.find((entry) => entry.key === key)!;

describe("System health summary from real state", () => {
  it("counts only real problems and names what is not confirmed working", () => {
    const view = buildSystemHealthView(facts());
    expect(view.summary.needs).toBe(0);
    // Maps has a key but no recorded use, so the page never says "everything is working".
    expect(view.summary.sentence).toContain("Nothing needs you.");
    expect(view.summary.sentence).toContain("Maps and address search (key present)");
    expect(view.summary.sentence).not.toContain("Everything else");
    expect(view.summary.sentence).toContain("Not set up: Card payments.");
    expect(area(view, "scheduled").state).toBe("working");
    expect(area(view, "payments")).toMatchObject({ state: "not_set_up", word: "Not set up" });
  });

  it("raises Xero renewal, an SMS failure, a failing feed and a failed task, each with its fix link", () => {
    const view = buildSystemHealthView(facts({
      xero: { ...facts().xero, renewBy: "2026-11-18T05:00:00.000Z" },
      sms: { ...facts().sms, failed24h: 2 },
      ical: { readable: true, enabledFeeds: 14, failing: [{ propertyId: "p1", propertyName: "Glebe House", since: "2026-11-15T21:00:00.000Z", error: "Airbnb returned 404" }], lastRunAt: NOW },
      tasks: [task({
        name: "reminder-dispatch",
        lastRun: { at: "2026-11-16T02:30:10.000Z", ok: false, durationMs: 9800, error: "Error: SMS provider timeout after 10000ms", skipped: false },
        failed24h: 1,
        failuresInARow: 1,
      })],
    }));
    const keys = view.summary.items.map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining(["xero", "sms", "ical", "task:reminder-dispatch"]));
    expect(view.summary.sentence).toMatch(/^4 things need you\./);
    expect(view.summary.items.find((item) => item.key === "xero")?.fix?.href).toBe("/v2/admin/settings?tab=xero");
    expect(view.summary.items.find((item) => item.key === "sms")?.fix?.href).toBe("/v2/admin/notifications/safeguards");
    expect(area(view, "xero").word).toBe("Renew by Wed 18 Nov");
    const reminder = view.tasks!.find((row) => row.name === "reminder-dispatch")!;
    expect(reminder.plainName).toBe("Send text and email reminders");
    expect(reminder.state).toBe("failing");
    expect(reminder.failure?.whatHappened).toContain("did not answer in time");
    expect(reminder.failure?.whatToDo).toContain("If it fails again, administrators get one inbox notice.");
    expect(reminder.failure?.technical).toContain("Task: reminder-dispatch");
  });

  it("says the emergency stop once instead of three stopped transports", () => {
    const view = buildSystemHealthView(facts({ safeguards: { readable: true, emergencyStop: true, paused: [] } }));
    expect(view.summary.items.map((item) => item.key)).toEqual(["emergency-stop"]);
    expect(area(view, "email").word).toBe("Stopped");
  });
});

describe("a worker that stopped reporting", () => {
  it("shows Cannot tell from here for scheduled work, the queue and every task, never the old ok", () => {
    const view = buildSystemHealthView(facts({ worker: { status: "STALE", lastSeenAt: "2026-11-16T02:40:00.000Z", registeredJobs: null } }));
    expect(area(view, "scheduled")).toMatchObject({ state: "unknown", word: "Cannot tell from here" });
    expect(area(view, "queue").state).toBe("unknown");
    expect(view.tasks!.every((row) => row.state === "unknown")).toBe(true);
    expect(view.tasks![0].lastRunText).toMatch(/^Last recorded: ok/);
    expect(view.tasks![0].nextAt).toBeNull();
    expect(view.summary.items[0]).toMatchObject({ key: "worker", title: "Background worker" });
    expect(view.summary.items[0].text).toContain("has not reported since 13:40");
    expect(view.workerKnown).toBe(false);
  });

  it("treats a missing or unreadable run history as unknown, not as zero failures", () => {
    const view = buildSystemHealthView(facts({ tasks: null, queue: null }));
    expect(area(view, "scheduled")).toMatchObject({ state: "unknown", short: "Run history could not be read" });
    expect(area(view, "queue")).toMatchObject({ state: "unknown", short: "Queue not readable" });
    expect(view.tasks).toBeNull();
  });

  it("a run that recorded no result is not counted as ok", () => {
    const view = buildSystemHealthView(facts({ tasks: [task({ name: "ical-sync", cron: "0 * * * *", lastRun: { at: "2026-11-16T03:00:00.000Z", ok: null, durationMs: null, error: null, skipped: false }, ok24h: 0, unknown24h: 3 })] }));
    expect(view.tasks![0].state).toBe("unknown");
    expect(view.tasks![0].last24h).toBe("3 without a result");
  });

  it("flags a task whose expected run did not happen as late", () => {
    const view = buildSystemHealthView(facts({ tasks: [task({ name: "ical-sync", cron: "0 * * * *", lastRun: { at: "2026-11-16T00:00:02.000Z", ok: true, durationMs: 100, error: null, skipped: false } })] }));
    expect(view.tasks![0].state).toBe("attention");
    expect(view.tasks![0].lastRunText).toContain("Late: due 13:00");
  });

  it("a failed check turns every card into Cannot tell from here", () => {
    const view = buildSystemHealthView(facts());
    expect(unreadableAreas(view.areas).every((entry) => entry.state === "unknown" && entry.word === "Cannot tell from here")).toBe(true);
  });
});

describe("key present is not working", () => {
  it("email, SMS, push, storage and AI with keys but no recorded use read Not tested", () => {
    const view = buildSystemHealthView(facts({
      email: { ...facts().email, handedOver24h: 0, lastHandedOverAt: null },
      sms: { ...facts().sms, handedOver24h: 0, lastHandedOverAt: null },
      push: { ...facts().push, handedOver24h: 0, lastHandedOverAt: null },
      storage: { ...facts().storage, lastUploadAt: null },
      ai: { ...facts().ai, okCalls24h: 0, lastOkAt: null },
    }));
    for (const key of ["email", "sms", "push", "storage", "ai"]) {
      expect(area(view, key), key).toMatchObject({ state: "unknown", word: "Not tested" });
    }
    expect(area(view, "maps")).toMatchObject({ state: "unknown", word: "Key present" });
    expect(view.areas.filter((entry) => entry.word === "Working").map((entry) => entry.key)).toEqual(expect.not.arrayContaining(["email", "sms", "push", "storage", "ai", "maps"]));
  });

  it("missing keys are Not set up and unreadable counts are Cannot tell", () => {
    const view = buildSystemHealthView(facts({
      email: { ...facts().email, keyPresent: false },
      sms: { ...facts().sms, providerName: "none", keyPresent: null },
      push: { ...facts().push, handedOver24h: null, failed24h: null },
    }));
    expect(area(view, "email").state).toBe("not_set_up");
    expect(area(view, "sms")).toMatchObject({ state: "not_set_up", word: "Switched off" });
    expect(area(view, "push").state).toBe("unknown");
  });

  it("failures with nothing handed over are Not working", () => {
    const view = buildSystemHealthView(facts({ email: { ...facts().email, handedOver24h: 0, failed24h: 5 } }));
    expect(area(view, "email")).toMatchObject({ state: "failing", word: "Not working" });
  });
});

describe("Copy details for support", () => {
  it("has times, task names and redacted errors, but no secrets, tokens or client data", () => {
    const view = buildSystemHealthView(facts({
      xero: { ...facts().xero, renewBy: "2026-11-18T05:00:00.000Z" },
      ical: { readable: true, enabledFeeds: 3, failing: [{ propertyId: "p1", propertyName: "Glebe House", since: NOW, error: "404 for https://www.airbnb.com/calendar/ical/123.ics?s=SECRETTOKEN" }], lastRunAt: NOW },
      tasks: [task({
        name: "xero-invoice-sync",
        lastRun: {
          at: "2026-11-16T02:20:00.000Z",
          ok: false,
          durationMs: 500,
          error: "Request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop token=sk_live_ABCDEFGHIJKLMNOP for olivia@harbourview.com.au +61 412 345 678 https://api.xero.com/x?code=AAA&state=BBB api_key: 'hunter2'",
          skipped: false,
        },
        failed24h: 1,
        failuresInARow: 1,
      })],
    }));
    const text = view.support;
    expect(text).toContain("xero-invoice-sync");
    expect(text).toContain("Request failed");
    for (const secret of ["eyJhbGciOiJIUzI1NiJ9", "sk_live_ABCDEFGHIJKLMNOP", "olivia@harbourview.com.au", "412 345 678", "code=AAA", "state=BBB", "hunter2", "SECRETTOKEN", "Glebe House", "Harbour Holdings"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("redaction keeps the message readable", () => {
    expect(redactSupportText("Error: SMS provider timeout after 10000ms")).toBe("Error: SMS provider timeout after 10000ms");
    expect(redactSupportText("password=abc123 and secret: xyz")).toBe("password=[redacted] and secret: [redacted]");
  });
});

describe("plain names and timetable", () => {
  it("every task the worker schedules has a plain name", () => {
    const source = readFileSync("workers/boss.ts", "utf8");
    const scheduled = Array.from(source.matchAll(/boss\.schedule\("([a-z0-9-]+)"/g)).map((match) => match[1]);
    expect(scheduled.length).toBeGreaterThan(40);
    expect(scheduled.filter((name) => !SCHEDULED_TASK_NAMES.includes(name))).toEqual([]);
    expect(scheduledTaskInfo("unknown-task")).toMatchObject({ plainName: "unknown-task" });
  });

  it("describes and steps cron schedules in Sydney time", () => {
    expect(describeCron("*/5 * * * *")).toBe("every 5 min");
    expect(describeCron("20 * * * *")).toBe("hourly at :20");
    expect(describeCron("15 8 * * *")).toBe("daily 08:15");
    expect(describeCron("0 8 * * 1")).toBe("Mondays 08:00");
    const now = new Date(NOW);
    expect(nextCronRun("15 8 * * *", now, "Australia/Sydney")?.toISOString()).toBe("2026-11-16T21:15:00.000Z");
    expect(nextCronRun("*/30 * * * *", now, "Australia/Sydney")?.toISOString()).toBe("2026-11-16T03:30:00.000Z");
    expect(previousCronRun("0 * * * *", now, "Australia/Sydney")?.toISOString()).toBe("2026-11-16T03:00:00.000Z");
  });

  it("explains common failures in plain words", () => {
    expect(plainFailure("Handler timeout after 600000ms")).toContain("time limit");
    expect(plainFailure("fetch failed")).toBe("an outside service could not be reached");
    expect(plainFailure(null)).toBe("it stopped without recording why");
  });
});
