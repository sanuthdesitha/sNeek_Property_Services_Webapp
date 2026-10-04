import type { NotificationCategory } from "@/lib/settings";

// PUSH-only reserved externalId namespace. Keep deliveryStatus free for inbox
// read state; email/SMS provider references and historic PUSH rows are untouched.
export const MOBILE_PENDING = "mobile-outbox:pending";
export const MOBILE_CLAIMED = "mobile-outbox:claimed:";
export const MOBILE_PREFIX = "mobile-outbox:";
export const MOBILE_REVIEW_REQUIRED = "mobile-outbox:REVIEW_REQUIRED";
export function mobilePendingMarker(category: NotificationCategory) {
  return `${MOBILE_PENDING}:${category}`;
}
export function markMobileOutboxRows<T>(input: T): T {
  const mark = (row: any) => {
    if (!row || row.channel !== "PUSH" || typeof row.userId !== "string" || !row.userId
      || (row.status && row.status !== "SENT") || row.externalId
      // Explicit durable INBOX intents must not acquire an implicit transport.
      || (typeof row.id === "string" && row.id.startsWith("intent-"))) return row;
    return { ...row, externalId: MOBILE_REVIEW_REQUIRED, errorMsg: "Mobile push needs review: producer did not declare a notification category." };
  };
  return (Array.isArray(input) ? input.map(mark) : mark(input)) as T;
}
