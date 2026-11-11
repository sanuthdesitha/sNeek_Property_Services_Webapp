// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Role } from "@prisma/client";

// Since 2026-11-11 the reminder runs on the notification pipeline
// (lib/notifications/office-sends.ts): the inbox row is a pipeline INBOX
// intent delivered at once; browser push and email keep the direct path while
// their outbox transports are off (the default here). The pipeline store and
// the inline delivery are mocked; their own tests cover them.
const m = vi.hoisted(() => ({
  session: vi.fn(), findJob: vi.fn(), notify: vi.fn(), audit: vi.fn(), push: vi.fn(), email: vi.fn(),
  enqueue: vi.fn(), inline: vi.fn(), authorize: vi.fn(), receipt: vi.fn(), receiptUpdate: vi.fn(), controls: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireRole: m.session }));
vi.mock("@/lib/db", () => {
  const tx = { pushSubscription: { findMany: vi.fn().mockResolvedValue([]) } };
  return { db: {
    job: { findUnique: m.findJob }, notification: { create: m.notify }, auditLog: { create: m.audit },
    appSetting: { findUnique: m.controls, create: m.receipt, update: m.receiptUpdate },
    $transaction: (run: (client: typeof tx) => unknown) => run(tx),
  } };
});
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/intent-store", () => ({ enqueueNotificationIntent: m.enqueue }));
vi.mock("@/lib/notifications/inline-dispatch", () => ({ deliverInboxIntentsNow: m.inline }));
vi.mock("@/lib/notifications/recipient-scopes", () => ({ authorizeEntityRecipient: m.authorize }));
vi.mock("@/lib/app-url", () => ({ resolveAppUrl: (path: string) => `https://app.test${path}` }));
import { POST as BULK } from "@/app/api/admin/jobs/bulk-remind/route";
import { POST as SINGLE } from "@/app/api/admin/jobs/[id]/remind/route";

const cleaner = (id: string, email: string | null = `${id}@test`) => ({ userId: id, user: { id, name: id === "c1" ? "Ana" : "Ben", email, role: "CLEANER" } });
const jobs: Record<string, unknown> = {
  paused: { id: "paused", jobNumber: "J-1", status: "PAUSED", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: "10:00", property: { name: "Bondi", address: "" }, assignments: [cleaner("c1")] },
  emailGap: { id: "emailGap", jobNumber: "J-2", status: "IN_PROGRESS", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: null, property: { name: "Manly", address: "" }, assignments: [cleaner("c1"), cleaner("c2", null)] },
  assigned: { id: "assigned", jobNumber: "J-3", status: "ASSIGNED", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: null, property: { name: "Coogee", address: "" }, assignments: [cleaner("c1")] },
  nobody: { id: "nobody", jobNumber: "J-4", status: "SUBMITTED", scheduledDate: new Date("2026-11-12T00:00:00Z"), startTime: null, property: { name: "Paddington", address: "" }, assignments: [] },
};
const post = (body: unknown) => BULK(new NextRequest("http://localhost/api/admin/jobs/bulk-remind", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: { id: "admin", role: Role.ADMIN } });
  m.findJob.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(jobs[where.id] ?? null));
  m.email.mockResolvedValue({ ok: true });
  vi.stubEnv("SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS", "");
  let counter = 0;
  m.enqueue.mockImplementation(() => Promise.resolve({ id: `intent-${++counter}` }));
  m.inline.mockImplementation((ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, { state: "inbox_available", notificationId: `intent-${id}` }]))));
  m.authorize.mockResolvedValue({ ok: true, role: "CLEANER" });
  m.receipt.mockResolvedValue({});
  m.receiptUpdate.mockResolvedValue({});
  m.controls.mockResolvedValue(null);
});

describe("POST /api/admin/jobs/bulk-remind", () => {
  it("reminds through the single service and returns a truthful outcome per job", async () => {
    const response = await post({ jobIds: ["paused", "assigned", "missing", "nobody", "paused"], method: "PUSH" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rows.map((row: { jobId: string; outcome: string }) => [row.jobId, row.outcome])).toEqual([
      ["paused", "requested"], ["assigned", "skipped"], ["missing", "not_found"], ["nobody", "skipped"],
    ]);
    expect(body.rows[0].message).toBe("Push requested for Ana; delivery is not confirmed.");
    expect(body.rows[0].message).not.toMatch(/delivered/i);
    expect(body.rows[1].message).toContain("not in a remindable state");
    expect(body.rows[3].message).toBe("No assigned cleaners to remind.");
    expect(body.summary).toEqual({ requested: 1, partial: 0, failed: 0, skipped: 2, notFound: 1 });
    // One pipeline inbox intent + one direct browser push per reminded cleaner, one audit per reminded job.
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][1]).toMatchObject({ transport: "INBOX", eventKey: "job.reminder.manual", recipient: { userId: "c1", scope: { kind: "ENTITY", type: "JOB_ASSIGNED_CLEANER", id: "paused" } } });
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: "admin", action: "JOB_REMINDER_SENT", jobId: "paused" });
  });

  it("reports a partly sent email job and keeps queued apart from delivered", async () => {
    const body = await (await post({ jobIds: ["emailGap"], method: "EMAIL" })).json();
    expect(body.rows[0]).toMatchObject({ outcome: "partial", requested: ["Ana"], failed: ["Ben"] });
    expect(body.rows[0].message).toBe("Email accepted by the provider for Ana; delivery is not confirmed. Not sent to Ben.");
    expect(m.email).toHaveBeenCalledTimes(1);
    expect(m.email.mock.calls[0][0]).toMatchObject({ kind: "job_reminder", to: "c1@test" });
    m.email.mockResolvedValue({ ok: false, error: "RESEND_API_KEY is not configured" });
    const failed = await (await post({ jobIds: ["paused"], method: "EMAIL" })).json();
    expect(failed.rows[0]).toMatchObject({ outcome: "failed", requested: [] });
  });

  it.each([
    [{ jobIds: [], method: "PUSH" }],
    [{ jobIds: ["paused"], method: "SMS" }],
    [{ jobIds: Array.from({ length: 201 }, (_, index) => `job-${index}`), method: "PUSH" }],
    [null],
  ])("refuses malformed input %# without sending", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(m.findJob).not.toHaveBeenCalled();
  });

  it.each([["UNAUTHORIZED", 401], ["FORBIDDEN", 403]])("refuses %s before reading or sending", async (message, status) => {
    m.session.mockRejectedValue(new Error(String(message)));
    expect((await post({ jobIds: ["paused"], method: "PUSH" })).status).toBe(status);
    expect(m.findJob).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it("admits administrators and operations managers only", async () => {
    await post({ jobIds: ["paused"], method: "PUSH" });
    expect(m.session).toHaveBeenCalledWith([Role.ADMIN, Role.OPS_MANAGER]);
  });
});

describe("single-job reminder keeps its responses", () => {
  const single = (id: string, body: unknown = { method: "PUSH" }) =>
    SINGLE(new NextRequest(`http://localhost/api/admin/jobs/${id}/remind`, { method: "POST", body: JSON.stringify(body) }), { params: { id } });
  it("answers 200, 409 notRemindable, 400 and 404 as before", async () => {
    expect(await (await single("paused")).json()).toEqual({
      sent: ["Ana"], failed: [], deliveryState: "QUEUED", message: "Push requested for Ana; delivery is not confirmed.",
    });
    const conflict = await single("assigned");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ notRemindable: true });
    expect((await single("nobody")).status).toBe(400);
    expect((await single("missing")).status).toBe(404);
  });
});

describe("reminder records the real delivery state", () => {
  const single = (id: string, body: unknown = { method: "PUSH" }) =>
    SINGLE(new NextRequest(`http://localhost/api/admin/jobs/${id}/remind`, { method: "POST", body: JSON.stringify(body) }), { params: { id } });

  it("audits a push as queued and unconfirmed, never as sent", async () => {
    await single("paused");
    const after = m.audit.mock.calls[0][0].data.after;
    expect(after).toMatchObject({ method: "PUSH", requested: ["Ana"], failed: [], deliveryState: "QUEUED", deliveryConfirmed: false });
    expect(after).not.toHaveProperty("sent");
    // The inbox intent explicitly asks for the phone push the legacy row had
    // (deliverInboxIntent turns it into the mobile-outbox marker; see
    // tests/lib/notification-entity-scope.test.ts), and ignores personal
    // preferences by default, as the manual reminder always did.
    expect(m.enqueue.mock.calls[0][1]).toMatchObject({ transport: "INBOX", mobilePushCategory: "jobs", recipientPreferences: "IGNORE" });
    expect(after.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ transport: "INBOX", path: "pipeline", state: "inbox_available" }),
      expect.objectContaining({ transport: "WEB_PUSH", path: "direct", state: "requested" }),
    ]));
  });

  it("an email is provider-accepted, not delivered", async () => {
    const body = await (await single("paused", { method: "EMAIL" })).json();
    expect(body).toMatchObject({ sent: ["Ana"], deliveryState: "PROVIDER_ACCEPTED", message: "Email accepted by the provider for Ana; delivery is not confirmed." });
    expect(m.audit.mock.calls[0][0].data.after).toMatchObject({ deliveryState: "PROVIDER_ACCEPTED", deliveryConfirmed: false });
  });

  it("a failed browser push does not mark a cleaner whose inbox notice was recorded as not reminded", async () => {
    m.push.mockRejectedValue(new Error("push service down"));
    const body = await (await single("paused")).json();
    expect(body).toMatchObject({ sent: ["Ana"], failed: [] });
    expect(m.enqueue).toHaveBeenCalledTimes(1);
  });

  it("escapes the admin note and names in the email body", async () => {
    await single("paused", { method: "EMAIL", note: "<script>x</script> & <b>now</b>" });
    const html: string = m.email.mock.calls[0][0].html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; &lt;b&gt;now&lt;/b&gt;");
  });
});

describe("reminder preferences switch (notifications area)", () => {
  const single = (id: string, body: unknown = { method: "PUSH" }) =>
    SINGLE(new NextRequest(`http://localhost/api/admin/jobs/${id}/remind`, { method: "POST", body: JSON.stringify(body) }), { params: { id } });
  it("applies personal preferences only after an administrator switches them on", async () => {
    await single("paused");
    expect(m.enqueue.mock.calls[0][1]).toMatchObject({ recipientPreferences: "IGNORE" });
    m.controls.mockResolvedValue({ value: { respectsPreferences: { "job.reminder.manual": true } }, updatedAt: new Date() });
    await single("paused");
    expect(m.enqueue.mock.calls[1][1]).not.toHaveProperty("recipientPreferences");
  });

  it("a retried request with the same key reuses the same pipeline event", async () => {
    await single("paused", { method: "PUSH", idempotencyKey: "retry-key-1" });
    await single("paused", { method: "PUSH", idempotencyKey: "retry-key-1" });
    expect(m.enqueue.mock.calls[0][1].eventId).toBe(m.enqueue.mock.calls[1][1].eventId);
  });
});
