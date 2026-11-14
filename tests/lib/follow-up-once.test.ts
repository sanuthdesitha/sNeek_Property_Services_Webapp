// @vitest-environment node
/**
 * Repeated-send paths found in the spam audit (2026-11-15):
 * - a client's 1-day / 3-day / 14-day follow-up email was sent once per time
 *   the job was queued (a job that passed QA twice queued every step twice);
 *   each step is now claimed once per job;
 * - the daily "unfinished job" push went to the cleaner of a job left PAUSED
 *   every evening for ever; it now stops after three.
 */
import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  receipts: new Set<string>(),
  email: vi.fn(async () => ({ ok: true, acceptance: "ACCEPTED", externalId: "provider-1" })),
  push: vi.fn(async () => undefined),
  reminders: 0,
  audit: vi.fn(async () => ({})),
}));

vi.mock("@/lib/db", () => ({
  db: {
    appSetting: {
      create: vi.fn(async ({ data }: { data: { key: string } }) => {
        if (m.receipts.has(data.key)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        m.receipts.add(data.key);
        return data;
      }),
      update: vi.fn(async () => ({})),
    },
    job: {
      findUnique: vi.fn(async () => ({
        id: "job-1", jobNumber: "J-1", jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-10T00:00:00Z"), satisfactionRating: null,
        property: { name: "House", suburb: "Bondi", clientId: "c1", client: { id: "c1", name: "Client", email: "client@example.invalid", users: [] } },
      })),
      findMany: vi.fn(async () => [{ id: "job-2", jobNumber: "J-2", status: "PAUSED", scheduledDate: new Date("2026-11-01T00:00:00Z"), property: { name: "Flat" }, assignments: [{ userId: "cleaner" }] }]),
    },
    auditLog: {
      findMany: vi.fn(async () => []),
      groupBy: vi.fn(async () => (m.reminders ? [{ jobId: "job-2", _count: { _all: m.reminders } }] : [])),
      create: m.audit,
    },
    notification: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ accountsEmail: "accounts@example.invalid" }) }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/wording/render", () => ({ loadNotificationWording: async () => ({ render: () => ({ title: "Unfinished", body: "Finish it", subject: "Thanks", html: "<p>Thanks</p>" }), line: () => "" }) }));
vi.mock("@/lib/client/ratings", () => ({ buildRatingToken: () => "token" }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => path }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { dispatchJobFollowUp } from "@/lib/ops/follow-up-sequences";
import { MAX_UNFINISHED_REMINDERS_PER_JOB, dispatchUnfinishedJobPushReminders } from "@/lib/ops/unfinished-reminders";

beforeEach(() => {
  m.receipts.clear();
  m.email.mockClear();
  m.push.mockClear();
  m.reminders = 0;
});

it("sends each follow-up step once per job however many copies were queued", async () => {
  expect(await dispatchJobFollowUp("job-1", "1d")).toEqual({ sent: true });
  expect(await dispatchJobFollowUp("job-1", "1d")).toEqual({ sent: false, reason: "already_sent" });
  expect(await dispatchJobFollowUp("job-1", "3d")).toEqual({ sent: true });
  expect(m.email).toHaveBeenCalledTimes(2);
});

it("stops the daily unfinished-job push after three nights for a job that never leaves PAUSED", async () => {
  m.reminders = MAX_UNFINISHED_REMINDERS_PER_JOB - 1;
  expect(await dispatchUnfinishedJobPushReminders(new Date("2026-11-15T06:00:00Z"))).toEqual({ reminded: 1, skipped: 0 });
  m.reminders = MAX_UNFINISHED_REMINDERS_PER_JOB;
  expect(await dispatchUnfinishedJobPushReminders(new Date("2026-11-16T06:00:00Z"))).toEqual({ reminded: 0, skipped: 1 });
  expect(m.push).toHaveBeenCalledTimes(1);
});
