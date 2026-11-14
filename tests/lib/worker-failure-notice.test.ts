// @vitest-environment node
/**
 * A scheduled task failing twice in a row tells administrators once, in the
 * inbox only (System health, 2026-11-16, owner default pending confirmation).
 * A sending-safeguard pause keeps its inbox notice and one email.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { incidents, send } = vi.hoisted(() => ({
  incidents: new Map<string, Record<string, unknown>>(),
  send: vi.fn(async (_input: unknown) => [{ userId: "a1", name: "Admin", transport: "INBOX", path: "pipeline", state: "inbox_available" }]),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findMany: vi.fn(async () => [{ id: "a1", role: "ADMIN", name: "Admin", email: "admin@example.com" }]) },
    outboundSafeguardIncident: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => incidents.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        incidents.set(where.id, { ...incidents.get(where.id), ...data });
        return incidents.get(where.id);
      }),
    },
  },
}));
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: send }));
vi.mock("@/lib/notifications/type-controls", () => ({ getNotificationTypeControls: vi.fn(async () => ({ disabledTransports: {} })) }));
vi.mock("@/lib/notifications/wording/render", () => ({
  loadNotificationWording: vi.fn(async () => ({ render: (_part: string, _transport: string, values: Record<string, string>) => ({ title: `Title ${values.jobName ?? values.label}`, body: "Body", subject: "Subject", html: "" }) })),
}));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.example${path}` }));

import { sendSafeguardAlert, WORKER_FAILING_TRANSPORTS } from "@/lib/notifications/safeguards/alerts";
import { catalogEntry } from "@/lib/notifications/catalog";

beforeEach(() => {
  incidents.clear();
  send.mockClear();
});

describe("failed scheduled task notice", () => {
  it("goes to the inbox only, with the plain task name, and opens System health", async () => {
    incidents.set("i1", { id: "i1", kind: "WORKER_FAILING", scopeKind: "JOB_NAME", scopeKey: "reminder-dispatch", attemptCount: 2, detail: { error: "timeout" }, alertedAt: null, sampleRecipients: [] });
    await sendSafeguardAlert("i1");
    expect(send).toHaveBeenCalledTimes(1);
    const input = send.mock.calls[0][0] as { transports: string[]; subject: string; url: string; eventId: string };
    expect(input.transports).toEqual(["INBOX"]);
    expect(WORKER_FAILING_TRANSPORTS).toEqual(["INBOX"]);
    expect(input.subject).toContain("Send text and email reminders (reminder-dispatch)");
    expect(input.url).toBe("https://app.example/v2/admin/diagnostics?tab=scheduled");
    expect(input.eventId).toBe("safeguard:i1");
  });

  it("is sent once per incident: an incident already alerted sends nothing", async () => {
    incidents.set("i2", { id: "i2", kind: "WORKER_FAILING", scopeKind: "JOB_NAME", scopeKey: "ical-sync", attemptCount: 2, detail: {}, alertedAt: null, sampleRecipients: [] });
    await sendSafeguardAlert("i2");
    await sendSafeguardAlert("i2");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a sending pause keeps its inbox notice and one email", async () => {
    incidents.set("i3", { id: "i3", kind: "BREAKER", scopeKind: "TYPE", scopeKey: "job.offer", label: "Job offers", attemptCount: 200, detail: { transport: "EMAIL" }, alertedAt: null, sampleRecipients: [] });
    await sendSafeguardAlert("i3");
    expect((send.mock.calls[0][0] as { transports: string[] }).transports).toEqual(["INBOX", "EMAIL"]);
  });

  it("the catalog says the scheduled-task notice is inbox only", () => {
    expect(catalogEntry("system.sending_safeguard")?.notes).toContain("A scheduled task failing twice in a row is inbox only too");
  });
});
