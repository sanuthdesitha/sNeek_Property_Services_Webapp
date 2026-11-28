/** Wording for job.evidence_override: "Camera not working — ask the office" (2026-11-28). */
import { editable, inbox } from "./build";

export const EVIDENCE_OVERRIDE_WORDING = editable("job.evidence_override", [
  inbox(
    "asked",
    "Asked (to the office)",
    "Photos missing: {{propertyName}}",
    "{{cleanerName}} cannot take {{photoCount}} photo(s) at {{propertyName}} ({{jobNumber}}) and asks to submit without them. Reason: {{note}} Decide on the job page.",
    { required: ["propertyName", "note"], note: "Inbox and phone push to the office (ADMIN, and OPS_MANAGER with the Jobs pack). Never email or SMS." },
  ),
  inbox(
    "decided",
    "Decided (to the cleaner)",
    "Missing photos: {{decision}}",
    "{{propertyName}} ({{jobNumber}}): {{decision}}. {{guidance}} Office reason: {{reason}}",
    { required: ["decision", "reason"], note: "Inbox and phone push to the cleaner who asked. Allowing changes only which photos the submit check waits for on this job." },
  ),
]);
