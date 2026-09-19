// @vitest-environment node
import { expect, it } from "vitest";
import { notificationEnvelopeSchema, notificationIntentKey, notificationEnvelopeHash, deliveryAttemptTransition } from "@/lib/notifications/intent-contract";
const envelope = () => notificationEnvelopeSchema.parse({ version: 1, eventId: "receipt-1", eventKey: "laundry.failed_pickup", entity: { type: "LaundryTask", id: "task" }, actorId: "driver", recipient: { userId: "admin", role: "ADMIN", scope: { kind: "ADMIN_OPERATIONS" } }, severity: "ACTION", transport: "INBOX", subject: "Review", body: "Failed pickup", jobId: "job" });
it("uses stable domain receipt/recipient/transport identity, not human text", () => {
  const input = envelope(); expect(notificationIntentKey(input)).toBe(notificationIntentKey({ ...input, body: "changed" })); expect(notificationEnvelopeHash(input)).not.toBe(notificationEnvelopeHash({ ...input, body: "changed" }));
  for (const other of [{ ...input, eventId: "receipt-2" }, { ...input, recipient: { ...input.recipient, userId: "other" } }, { ...input, transport: "WEB_PUSH" as const }]) expect(notificationIntentKey(other)).not.toBe(notificationIntentKey(input));
});
it("validates versioned typed scope and rejects unbounded or extra fields", () => {
  for (const value of [{ ...envelope(), version: 2 }, { ...envelope(), eventId: "" }, { ...envelope(), recipient: { userId: "admin", role: "PUBLIC" } }, { ...envelope(), body: "x".repeat(20001) }, { ...envelope(), command: "run" }]) expect(notificationEnvelopeSchema.safeParse(value).success).toBe(false);
});
it("allows only internal links without URL normalization escapes", () => {
  for (const url of ["//evil.example", "/\\evil.example", "/\nevil.example", "/\tevil.example", "https://evil.example", "/bad\u007fpath"]) {
    expect(notificationEnvelopeSchema.safeParse({ ...envelope(), url }).success).toBe(false);
  }
  expect(notificationEnvelopeSchema.parse({ ...envelope(), url: "/v2/admin/jobs?view=board#job" }).url).toBe("/v2/admin/jobs?view=board#job");
});
it("never retries accepted, uncertain, skipped or permanent rejection", () => {
  const now = new Date();
  expect(deliveryAttemptTransition({ kind: "ACCEPTED", providerReference: "ref" }, 1, now)).toEqual({ status: "ACCEPTED", nextAttemptAt: null });
  expect(deliveryAttemptTransition({ kind: "UNCERTAIN", errorCode: "network_timeout" }, 1, now)).toEqual({ status: "UNCERTAIN", nextAttemptAt: null });
  expect(deliveryAttemptTransition({ kind: "SKIPPED", errorCode: "preference" }, 1, now)).toEqual({ status: "SKIPPED", nextAttemptAt: null });
  expect(deliveryAttemptTransition({ kind: "NOT_ACCEPTED", retryable: false, errorCode: "invalid" }, 1, now)).toEqual({ status: "FAILED", nextAttemptAt: null });
});
it("backs off only known-not-accepted transient errors and stops after five attempts", () => {
  const now = new Date("2026-09-13T01:00:00Z"); const outcome = { kind: "NOT_ACCEPTED" as const, retryable: true, errorCode: "rate_limited" };
  expect(deliveryAttemptTransition(outcome, 1, now)).toEqual({ status: "RETRY_WAIT", nextAttemptAt: new Date(now.getTime() + 60000) });
  expect(deliveryAttemptTransition(outcome, 4, now)).toEqual({ status: "RETRY_WAIT", nextAttemptAt: new Date(now.getTime() + 480000) });
  expect(deliveryAttemptTransition(outcome, 5, now)).toEqual({ status: "FAILED", nextAttemptAt: null });
});
