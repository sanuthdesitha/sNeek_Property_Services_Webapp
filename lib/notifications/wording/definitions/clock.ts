/** Wording for job.clock_changes (in-app notices; the phone push is made from the inbox row). */
import { editable, inbox, line } from "./build";

export const CLOCK_CHANGES_WORDING = editable("job.clock_changes", [
  inbox("auto-clock-out", "Auto clock-out", "Auto clocked out", "{{jobNumber}}: {{propertyName}} was automatically clocked out at {{time}}.", { required: ["jobNumber"], note: "To the cleaner, when the clock ran past the auto clock-out limit." }),
  inbox("left-site", "Left the site (cleaner)", "Clocked out — left job site", "You've been clocked out — you left the job site. Resume the job if this was a mistake.", { note: "To the cleaner." }),
  inbox("left-site-office", "Left the site (office)", "Cleaner auto clocked out (left site)", "{{cleanerName}} left the site at {{jobLabel}} (~{{distance}}m away) and was clocked out automatically.", { required: ["jobLabel"], note: "To administrators." }),
  inbox("auto-paused", "Auto-paused", "Job auto-paused", "{{jobNumber}}: {{propertyName}} ran for over 24 hours and was automatically paused. Please open it and submit your checklist, or resume if you're still on site.", { required: ["jobNumber"], note: "To the assigned cleaners; also sent as a browser push." }),
  inbox("times-edited", "Clock times edited", "Clock times updated by admin", "{{jobNumber}}: An admin amended your recorded clock times{{segmentTotal}}.", { required: ["jobNumber"], note: "To the cleaner whose times were edited." }),
  line("segment-total", "New segment total", "INBOX", " (new segment total: {{minutes}} minutes)", "Added when the edited segment has a duration."),
]);
