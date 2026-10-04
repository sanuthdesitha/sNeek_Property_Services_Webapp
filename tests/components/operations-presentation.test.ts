import { expect, it } from "vitest";
import { operationalDay, operationalLabel, operationalTimestamp } from "@/components/operations/presentation";

it("distinguishes observed custody, registration and unknown history", () => {
  expect(operationalLabel("REGISTERED")).toBe("Linked to run");
  expect(operationalLabel("PICKED_UP")).toBe("Pickup observed");
  expect(operationalLabel("ADMIN_RECORDED")).toBe("Recorded by administrator");
  expect(operationalLabel("INITIAL_INSPECTION")).toBe("Initial inspection needed");
  expect(operationalLabel("CARE_CARRIED_FORWARD")).toBe("Care carried forward");
  expect(operationalLabel(null)).toBe("Unknown");
});
it("formats instants in the organisation timezone through Sydney daylight saving", () => {
  expect(operationalTimestamp("2026-10-03T15:30:00Z", "Australia/Sydney")).toBe("4 Oct 2026, 1:30 AM");
  expect(operationalTimestamp("2026-10-03T16:30:00Z", "Australia/Sydney")).toBe("4 Oct 2026, 3:30 AM");
  expect(operationalTimestamp("2026-10-03T16:30:00Z", "Australia/Perth")).toBe("4 Oct 2026, 12:30 AM");
  expect(operationalTimestamp(null, "Australia/Sydney")).toBe("Unknown");
  expect(operationalTimestamp("invalid", "Australia/Sydney")).toBe("Unknown");
});
it("keeps calendar-day labels and due-state meanings without timezone shifts", () => {
  expect(operationalDay("2026-10-04")).toBe("4 Oct 2026");
  expect(operationalDay("2026-10-04T00:00:00Z")).toBe("4 Oct 2026");
  expect(operationalDay("CONDITION_REVIEW")).toBe("Condition needs office review");
  expect(operationalDay("UNSCHEDULED")).toBe("Not scheduled");
  expect(operationalDay(null, "Not recorded")).toBe("Not recorded");
});
