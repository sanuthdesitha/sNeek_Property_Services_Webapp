// @vitest-environment node
import { expect, it } from "vitest";
import { notificationLifecycle, notificationLifecycleSchema, dispatchLabels, providerLabels } from "@/lib/notifications/delivery-lifecycle";
const record = (overrides = {}) => ({ channel: "PUSH", status: "SENT", deliveryStatus: null, externalId: null, ...overrides });
it("does not confuse an inbox copy with a successful device push", () => {
  expect(notificationLifecycle(record())).toEqual({ dispatch: "INBOX_AVAILABLE", provider: "NOT_RECORDED", personalRead: "UNREAD", acknowledgement: "NOT_RECORDED" });
  expect(notificationLifecycle(record({ deliveryStatus: "OPENED" }))).toMatchObject({ provider: "NOT_RECORDED", personalRead: "READ", acknowledgement: "NOT_RECORDED" });
});
it.each(["DELIVERED", "OPENED", "BOUNCED"])("preserves provider evidence %s without inventing personal read or acknowledgement", deliveryStatus => {
  const result = notificationLifecycle(record({ channel: "EMAIL", deliveryStatus })); expect(result).toMatchObject({ provider: deliveryStatus, personalRead: "NOT_APPLICABLE", acknowledgement: "NOT_RECORDED" }); expect(providerLabels[result.provider]).toBeTruthy();
});
it.each([null, "PENDING"])("requires an external provider reference to represent acceptance (%s)", deliveryStatus => {
  expect(notificationLifecycle(record({ channel: "EMAIL", deliveryStatus, externalId: "provider-reference" })).provider).toBe("ACCEPTED");
  expect(notificationLifecycle(record({ channel: "SMS", deliveryStatus })).provider).toBe("NOT_RECORDED");
});
it.each(["PENDING", "FAILED", "SENT", "OTHER"])("keeps dispatch %s separate from receipt", status => {
  const result = notificationLifecycle(record({ channel: "EMAIL", status })); expect(result.dispatch).toBe(status === "SENT" ? "SENT_RECORDED" : status === "OTHER" ? "UNKNOWN" : status); expect(result.provider).toBe("NOT_RECORDED"); expect(dispatchLabels[result.dispatch]).toBeTruthy();
});
it("preserves unknown provider status without claiming delivery", () => {
  expect(notificationLifecycle(record({ channel: "SMS", deliveryStatus: "UNRECOGNIZED" })).provider).toBe("UNKNOWN"); expect(notificationLifecycle(record({ channel: "OTHER" })).provider).toBe("NOT_RECORDED");
  expect(notificationLifecycleSchema.safeParse({ ...notificationLifecycle(record()), acknowledgement: "DELIVERED" }).success).toBe(false);
});
