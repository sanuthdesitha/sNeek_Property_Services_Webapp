// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  intents: vi.fn(), intentCount: vi.fn(), notifications: vi.fn(), notificationCount: vi.fn(), logs: vi.fn(), logCount: vi.fn(),
  users: vi.fn(), intent: vi.fn(), notification: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  notificationIntent: { findMany: m.intents, count: m.intentCount, findUnique: m.intent },
  notification: { findMany: m.notifications, count: m.notificationCount, findUnique: m.notification },
  notificationLog: { findMany: m.logs, count: m.logCount, findUnique: vi.fn() },
  user: { findMany: m.users },
} }));

import { deliveryDetail, intentWhere, listDeliveries, notificationWhere, templateLogWhere } from "@/lib/notifications/delivery-log";
import { notificationRow, redactSensitiveText, intentState, notificationState, mergePage } from "@/lib/notifications/delivery-log-map";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 10, minute));
const intent = (id: string, minute: number) => ({ id, eventKey: "job.reminder.manual", recipientId: "u1", transport: "INBOX", status: "ACCEPTED", updatedAt: at(minute), createdAt: at(minute), lastErrorCode: null, attemptCount: 1, envelope: { subject: "Unfinished job reminder", body: "Lockbox code 4821", jobId: "job-1" }, attempts: [{ status: "ACCEPTED" }] });
const notification = (id: string, minute: number) => ({ id, userId: "u1", jobId: null, channel: "EMAIL", status: "SENT", subject: "New job offer", errorMsg: null, externalId: "resend-1", deliveryStatus: "PENDING", createdAt: at(minute) });

beforeEach(() => {
  vi.resetAllMocks();
  m.users.mockResolvedValue([{ id: "u1", name: "Ana", email: "ana@example.invalid", role: "CLEANER" }]);
  m.intents.mockResolvedValue([intent("a", 5), intent("b", 1)]);
  m.notifications.mockResolvedValue([notification("c", 4), notification("d", 2)]);
  m.logs.mockResolvedValue([]);
  m.intentCount.mockResolvedValue(2);
  m.notificationCount.mockResolvedValue(2);
  m.logCount.mockResolvedValue(0);
});

describe("truthful states and redaction", () => {
  it("never calls a queued or accepted message delivered", () => {
    expect(intentState("QUEUED", "EMAIL")).toBe("queued");
    expect(intentState("ACCEPTED", "EMAIL")).toBe("provider_accepted");
    expect(intentState("ACCEPTED", "INBOX")).toBe("inbox_available");
    expect(notificationState({ channel: "EMAIL", status: "SENT", deliveryStatus: null, externalId: null })).toBe("sent_recorded");
    expect(notificationState({ channel: "EMAIL", status: "SENT", deliveryStatus: "DELIVERED", externalId: "x" })).toBe("delivered");
  });

  it("masks codes, PINs and link tokens", () => {
    expect(redactSensitiveText("Lockbox code: 4821, gate 9921")).toBe("Lockbox code: •••, gate •••");
    expect(redactSensitiveText("Open https://app.test/pay?token=abc123")).toBe("Open https://app.test/pay?…");
    expect(notificationRow({ ...notification("x", 1), subject: "Your key safe 1234", errorMsg: "PIN 9999 rejected" }, "Ana").subject).not.toContain("1234");
  });
});

describe("paged unified list", () => {
  it("merges pipeline and direct rows by time with the real total", async () => {
    const page = await listDeliveries(new URLSearchParams({ page: "1", pageSize: "3" }));
    expect(page.rows.map((row) => row.id)).toEqual(["intent:a", "notification:c", "notification:d"]);
    expect(page.total).toBe(4);
    expect(page.rows[0]).toMatchObject({ typeKey: "job.reminder.manual", path: "pipeline", state: "inbox_available", recipientLabel: "Ana (cleaner)" });
    expect(page.rows[1]).toMatchObject({ typeKey: "job.offer", path: "direct", state: "provider_accepted" });
    // Every source reads its own sorted prefix of the requested window.
    expect(m.intents.mock.calls[0][0]).toMatchObject({ skip: 0, take: 3, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  });

  it("pages a single source in the database", async () => {
    await listDeliveries(new URLSearchParams({ page: "3", pageSize: "10", source: "intent" }));
    expect(m.intents.mock.calls[0][0]).toMatchObject({ skip: 20, take: 10 });
    expect(m.notifications).not.toHaveBeenCalled();
  });

  it("refuses bad filters and combined pages too deep to merge exactly", async () => {
    await expect(listDeliveries(new URLSearchParams({ state: "delivered-ish" }))).rejects.toMatchObject({ status: 400 });
    await expect(listDeliveries(new URLSearchParams({ page: "60", pageSize: "25" }))).rejects.toMatchObject({ field: "page" });
    await expect(listDeliveries(new URLSearchParams({ sort: "recipient" }))).rejects.toMatchObject({ field: "sort" });
  });

  it("filters by type, state, transport and date in each source", () => {
    expect(intentWhere({ type: "job.reminder.manual", state: "queued", transport: "INBOX" }, null)).toEqual({ AND: [{ eventKey: { in: ["job.reminder.manual"] } }, { status: "QUEUED" }, { transport: "INBOX" }] });
    expect(intentWhere({ transport: "MOBILE_PUSH" }, null)).toBeNull();
    expect(notificationWhere({ transport: "WEB_PUSH" }, null)).toBeNull();
    expect(notificationWhere({ transport: "MOBILE_PUSH" }, ["u1"])).toEqual({ AND: [{ channel: "PUSH", externalId: { startsWith: "mobile-outbox:" } }, { userId: { in: ["u1"] } }] });
    expect(templateLogWhere({ type: "job.offer" })).toBeNull();
    expect(intentWhere({ from: "2026-11-01T00:00:00.000Z" }, null)).toEqual({ AND: [{ createdAt: { gte: new Date("2026-11-01T00:00:00.000Z") } }] });
  });

  it("merges in either direction", () => {
    const rows = [[{ id: "a", time: at(1).toISOString() }], [{ id: "b", time: at(2).toISOString() }]] as never;
    expect(mergePage(rows, "asc", 0, 2).map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("drill-in metadata", () => {
  it("never returns a message body, email HTML or provider reference value", async () => {
    m.intent.mockResolvedValue({ ...intent("a", 1), envelope: { eventId: "e1", subject: "Gate code 1234", body: "Lockbox 4821", emailHtml: "<p>secret</p>", recipient: { scope: { kind: "ENTITY" } } }, attempts: [{ number: 1, status: "ACCEPTED", errorCode: null, providerReference: "resend-ref-77", startedAt: at(1), finishedAt: at(1) }] });
    const detail = JSON.stringify(await deliveryDetail("intent:a"));
    expect(detail).not.toContain("4821");
    expect(detail).not.toContain("<p>secret</p>");
    expect(detail).not.toContain("resend-ref-77");
    expect(detail).not.toContain("1234");
    expect(detail).toContain("\"bodyLength\":12");
    expect(await deliveryDetail("bogus")).toBeNull();
  });
});
