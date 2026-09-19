import { z } from "zod";

export const notificationLifecycleSchema = z.object({
  dispatch: z.enum(["PENDING", "INBOX_AVAILABLE", "SENT_RECORDED", "FAILED", "UNKNOWN"]),
  provider: z.enum(["NOT_RECORDED", "ACCEPTED", "DELIVERED", "OPENED", "BOUNCED", "UNKNOWN"]),
  personalRead: z.enum(["READ", "UNREAD", "NOT_APPLICABLE"]),
  acknowledgement: z.enum(["NOT_RECORDED", "ACKNOWLEDGED"]),
}).strict();
export type NotificationLifecycle = z.infer<typeof notificationLifecycleSchema>;

/** Legacy records contain different evidence per channel; unknown is not success. */
export function notificationLifecycle(record: {
  channel: string; status: string; deliveryStatus: string | null; externalId: string | null;
}): NotificationLifecycle {
  const inbox = record.channel === "PUSH";
  const providerChannel = record.channel === "EMAIL" || record.channel === "SMS";
  const providerStatus = record.deliveryStatus;
  let provider: NotificationLifecycle["provider"] = "NOT_RECORDED";
  if (providerChannel) {
    if (providerStatus === "DELIVERED" || providerStatus === "OPENED" || providerStatus === "BOUNCED") provider = providerStatus;
    else if (record.status === "SENT" && record.externalId && (!providerStatus || providerStatus === "PENDING")) provider = "ACCEPTED";
    else if (providerStatus && providerStatus !== "PENDING") provider = "UNKNOWN";
  }
  return {
    dispatch: record.status === "PENDING" ? "PENDING" : record.status === "FAILED" ? "FAILED"
      : record.status === "SENT" ? inbox ? "INBOX_AVAILABLE" : "SENT_RECORDED" : "UNKNOWN",
    provider,
    personalRead: inbox ? providerStatus === "OPENED" ? "READ" : "UNREAD" : "NOT_APPLICABLE",
    // Recipient acknowledgement is joined from inbox state, never provider evidence.
    acknowledgement: "NOT_RECORDED",
  };
}

export const dispatchLabels: Record<NotificationLifecycle["dispatch"], string> = {
  PENDING: "Pending dispatch; no delivery confirmed",
  INBOX_AVAILABLE: "Available in your inbox",
  SENT_RECORDED: "Sent recorded",
  FAILED: "Dispatch failed",
  UNKNOWN: "Dispatch status unavailable",
};
export const providerLabels: Record<NotificationLifecycle["provider"], string> = {
  NOT_RECORDED: "No provider delivery evidence recorded",
  ACCEPTED: "Provider accepted; human receipt is not confirmed",
  DELIVERED: "Provider reported delivery; human receipt is not confirmed",
  OPENED: "Provider reported an open; acknowledgement is not confirmed",
  BOUNCED: "Provider reported a bounce",
  UNKNOWN: "Provider status is unrecognized",
};
