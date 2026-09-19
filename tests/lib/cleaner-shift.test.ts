import { expect, it } from "vitest";
import { isCleanerShiftOffer } from "@/lib/cleaner/shift";
it.each(["UNASSIGNED", "OFFERED", "ASSIGNED"])("uses the cleaner's pending response in %s", status => {
  expect(isCleanerShiftOffer({ status, assignments: [{ userId: "other", responseStatus: "ACCEPTED" }, { userId: "me", responseStatus: "PENDING" }] }, "me")).toBe(true);
  expect(isCleanerShiftOffer({ status, assignments: [{ userId: "other", responseStatus: "PENDING" }, { userId: "me", responseStatus: "ACCEPTED" }] }, "me")).toBe(false);
});
it.each(["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"])("does not offer decline controls once the job reaches %s", status => {
  expect(isCleanerShiftOffer({ status, assignments: [{ userId: "me", responseStatus: "PENDING" }] }, "me")).toBe(false);
});
it("preserves the legacy missing-response fallback only for offered jobs", () => {
  expect(isCleanerShiftOffer({ status: "OFFERED", assignments: [{ userId: "me" }] }, "me")).toBe(true);
  expect(isCleanerShiftOffer({ status: "ASSIGNED", assignments: [{ userId: "me" }] }, "me")).toBe(false);
});
