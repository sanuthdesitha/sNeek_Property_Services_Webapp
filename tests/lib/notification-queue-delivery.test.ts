// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { queueDelivery, type DurableDeliveryContext } from "@/lib/notifications/queue-delivery";
import { deliverNotificationToRecipients, type DeliveryInput } from "@/lib/notifications/delivery";
import { sendNotification } from "@/lib/notifications/engine";
const m = vi.hoisted(() => ({ enqueue: vi.fn(), subscriptions: vi.fn(), template: vi.fn(), email: vi.fn(), sms: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/notifications/intent-store", () => ({ enqueueNotificationIntent: m.enqueue, NotificationIntentError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock("@/lib/notifications/email", () => ({ sendEmailDetailed: m.email }));
vi.mock("@/lib/notifications/sms", () => ({ sendSmsDetailed: m.sms }));
vi.mock("@/lib/notifications/web-push", () => ({ sendWebPushToUser: m.push }));
const recipient = { id: "admin", role: "ADMIN" as const };
const context = (): DurableDeliveryContext => ({ tx: { pushSubscription: { findMany: m.subscriptions }, notificationTemplate: { findUnique: m.template } } as never,
  eventId: "receipt", eventKey: "job.changed", entity: { type: "Job", id: "job" }, actorId: "actor", severity: "ACTION", scope: { kind: "ADMIN_OPERATIONS" } });
const input = (): DeliveryInput => ({ recipients: [recipient, recipient], category: "jobs", jobId: "job", web: { subject: "Work", body: "Changed" }, url: "/v2/admin/jobs/job", kind: "admin_alert",
  email: user => ({ subject: `For ${user.id}`, html: "<strong>Changed</strong>", logBody: "Summary" }), sms: () => "Changed SMS" });
beforeEach(() => { vi.resetAllMocks(); m.subscriptions.mockResolvedValue([{ id: "one" }, { id: "two" }]); m.enqueue.mockImplementation(async (_tx, envelope) => envelope); m.template.mockResolvedValue({ emailSubject: "Invoice {{id}}", emailBodyHtml: "<p>{{id}}</p>", emailBodyText: "Invoice {{id}}", pushTitle: "Invoice", pushBody: "Ready", smsBody: "Invoice ready" }); });
it("queues each recipient once and each push device separately with exact resolved content", async () => {
  const ctx = context(); await queueDelivery(input(), ctx);
  expect(m.enqueue).toHaveBeenCalledTimes(5);
  expect(m.enqueue).toHaveBeenCalledWith(ctx.tx, expect.objectContaining({ transport: "EMAIL", emailHtml: "<strong>Changed</strong>", emailKind: "admin_alert", body: "Summary", eventId: "receipt" }));
  expect(m.enqueue.mock.calls.filter(([, item]) => item.transport === "WEB_PUSH").map(([, item]) => item.subscriptionId)).toEqual(["one", "two"]);
  expect(m.enqueue.mock.calls[4][1].url).toBe("/v2/admin/jobs/job");
  expect(m.email).not.toHaveBeenCalled(); expect(m.sms).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
});
it("preserves the existing delivery entry point while using caller transaction and selected transports", async () => {
  await deliverNotificationToRecipients({ ...input(), durable: { ...context(), transports: ["INBOX"] } });
  expect(m.enqueue).toHaveBeenCalledTimes(1); expect(m.subscriptions).not.toHaveBeenCalled(); expect(m.email).not.toHaveBeenCalled();
});
it("rejects unsupported recipient authorization before any durable write", async () => {
  await expect(queueDelivery({ ...input(), recipients: [{ id: "client", role: "CLIENT" }] }, context())).rejects.toThrow("authorization adapter");
  expect(m.enqueue).not.toHaveBeenCalled();
});
it("propagates queue failure so the domain transaction cannot falsely commit notification intent", async () => {
  m.enqueue.mockRejectedValue(new Error("db unavailable"));
  await expect(deliverNotificationToRecipients({ ...input(), durable: context() })).rejects.toThrow("db unavailable");
});
it("template entry point uses the same queue with kind and event preference identity", async () => {
  await sendNotification("invoice_approved", { id: "42" }, { recipientRole: "ADMIN", channels: ["EMAIL"], durable: { ...context(), recipient } });
  expect(m.enqueue).toHaveBeenCalledTimes(1);
  expect(m.enqueue.mock.calls[0][1]).toMatchObject({ eventKey: "invoice_approved", subject: "Invoice 42", emailHtml: "<p>42</p>", emailKind: "admin_alert", templateRecipientRole: "ADMIN" });
  expect(m.email).not.toHaveBeenCalled();
});
it("template errors and unsupported scopes fail the domain transaction rather than logging false success", async () => {
  const options = { durable: { ...context(), recipient } };
  await expect(sendNotification("unknown", {}, options)).rejects.toThrow("Unknown");
  await expect(sendNotification("invoice_approved", {}, { ...options, recipientRole: "CLIENT" })).rejects.toThrow("authorization");
  m.template.mockResolvedValueOnce(null); await expect(sendNotification("invoice_approved", {}, options)).rejects.toThrow("unavailable");
  m.template.mockResolvedValueOnce({}); await expect(sendNotification("invoice_approved", {}, { ...options, channels: ["EMAIL"] })).rejects.toThrow("incomplete");
  expect(m.enqueue).not.toHaveBeenCalled();
});
