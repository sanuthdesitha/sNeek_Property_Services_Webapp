/** Wording for job.attendance_notice: "I can't attend" and "Running late" (2026-11-28). */
import { editable, inbox } from "./build";

export const ATTENDANCE_NOTICE_WORDING = editable("job.attendance_notice", [
  inbox(
    "cant-attend",
    "Can't attend (to the office)",
    "Can't attend: {{propertyName}}",
    "{{cleanerName}} can't attend {{propertyName}} ({{jobNumber}}, {{when}}). Reason: {{reason}} The job is unchanged until you act on it.",
    { required: ["propertyName", "reason"], note: "Inbox and phone push to the office (ADMIN, and OPS_MANAGER with the Jobs pack). Never email or SMS." },
  ),
  inbox(
    "running-late",
    "Running late (to the office)",
    "Running {{minutes}} min late: {{propertyName}}",
    "{{cleanerName}} expects to be about {{minutes}} minutes late to {{propertyName}} ({{jobNumber}}, {{when}}). Reason: {{reason}}",
    { required: ["propertyName", "minutes", "reason"], note: "Inbox and phone push to the office. The client is not told by this notice." },
  ),
]);
