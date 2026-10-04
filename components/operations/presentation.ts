import { formatInTimeZone } from "date-fns-tz";

/** Display only: never change stored status values or calendar-day semantics. */
const labels: Record<string, string> = {
  REGISTERED: "Linked to run", PICKED_UP: "Pickup observed", RETURNED: "Return observed",
  UNKNOWN: "Unknown", ADMIN_RECORDED: "Recorded by administrator",
  CLEANER_RECORDED: "Recorded by cleaner", LAUNDRY_RECORDED: "Recorded by laundry team",
  INITIAL_INSPECTION: "Initial inspection needed", CONDITION_REVIEW: "Condition needs office review",
  UNSCHEDULED: "Not scheduled", NOT_APPLICABLE: "Not applicable", APPLICABLE: "Applicable",
  POSSIBLE_DUPLICATE_REVIEW: "Possible duplicate — review needed",
  EXISTING_ROUTINE_REVIEW: "Existing routine — review needed",
  ROUTINE_PROPOSAL_REQUIRED: "Routine proposal required", PERIODIC_MISSING: "Periodic care not covered",
};
export function operationalLabel(value: string | null | undefined, empty = "Unknown") {
  if (!value) return empty;
  return labels[value] ?? value.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
}
export function operationalTimestamp(value: string | null | undefined, timeZone: string, empty = "Unknown") {
  if (!value || Number.isNaN(new Date(value).getTime())) return empty;
  return formatInTimeZone(new Date(value), timeZone, "d MMM yyyy, h:mm a");
}
export function operationalDay(value: string | null | undefined, empty = "Unknown") {
  if (!value) return empty;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return operationalLabel(value, empty);
  // Service and due dates are calendar days, not instants in the viewer's zone.
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(day.getTime()) ? empty : formatInTimeZone(day, "UTC", "d MMM yyyy");
}
