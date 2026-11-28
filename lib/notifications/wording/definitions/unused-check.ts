/** Wording for job.unused_check: "Looks unused — ask the office" (2026-11-28). */
import { editable, inbox, line } from "./build";

export const UNUSED_CHECK_WORDING = editable("job.unused_check", [
  inbox(
    "asked",
    "Asked (to the office)",
    "Looks unused: {{propertyName}}",
    "{{cleanerName}} says {{propertyName}} ({{jobNumber}}) looks like nobody stayed and is waiting for your answer before cleaning.{{cleanerNoteSentence}} Answer in Approvals → Looks unused.",
    { required: ["propertyName"], note: "Inbox and phone push to the office (ADMIN, and OPS_MANAGER with the Jobs pack). Never email or SMS." },
  ),
  inbox(
    "answered",
    "Answered (to the cleaner)",
    "Office answer: {{officeAnswer}}",
    "{{propertyName}} ({{jobNumber}}): {{officeAnswer}}. {{answerGuidance}}{{officeNoteSentence}}",
    { required: ["officeAnswer"], note: "Inbox and phone push to the cleaners on the job. The answer does not change the job or pay." },
  ),
  line("cleaner-note", "Cleaner note sentence", "INBOX", " Cleaner note: {{note}}", "Added when the cleaner wrote a note."),
  line("office-note", "Office note sentence", "INBOX", " Note from the office: {{note}}", "Added when the office wrote a note."),
]);
