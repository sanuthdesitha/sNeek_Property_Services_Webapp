/** Wording for job.clock_changes (in-app notices; the phone push is made from the inbox row). */
import { editable, elsewhere, inbox, line } from "./build";

export const LEFT_SITE_WORDING = elsewhere(
  "job.left_site_clock_out",
  "Uses the \"Left the site\" parts of Clock and pause changes.",
  "/v2/admin/notifications",
);

export const LOCATION_SHARING_WORDING = editable("location.sharing", [
  inbox("cleaner-started", "Started (cleaner)", "Your location is being shared", "From now until you clock out, the office can see where you are on {{jobLabel}}.{{clientSuffix}} Keep the app open while travelling.", { required: ["jobLabel"], note: "When a cleaner goes on the way or clocks in." }),
  line("client-suffix", "Client can see it", "INBOX", " The client can also see you while you are on the way.", "Added only when this client's live-location switch is on."),
  inbox("cleaner-stopped", "Stopped (cleaner)", "Location sharing stopped", "You clocked out of {{jobLabel}}. Your location is no longer shared.", { required: ["jobLabel"], note: "When a cleaner's clock stops." }),
  inbox("driver-started", "Started (driver)", "Your location is being shared", "Your laundry route is active. The office can see where you are until you end the route. Keep the app open while driving.", { note: "When a driver's route becomes active." }),
  inbox("driver-stopped", "Stopped (driver)", "Location sharing stopped", "Your laundry route has ended. Your location is no longer shared.", { note: "When a driver's route ends." }),
]);

export const START_WITHOUT_FIX_WORDING = editable("location.start_without_fix", [
  inbox("office-clock", "Clock started (office)", "Started without a location fix", "{{personName}} started their clock at {{placeLabel}} without a location fix ({{errorLabel}}). Reason given: \"{{reason}}\". The first position their phone gets will be shown as a late start location.", { required: ["placeLabel"], note: "To the office, when a cleaner clocks in or resumes without a fix." }),
  inbox("office-drive", "On the way (office)", "On the way without a location fix", "{{personName}} set off to {{placeLabel}} without a location fix ({{errorLabel}}). Reason given: \"{{reason}}\".", { required: ["placeLabel"], note: "To the office, when a cleaner goes on the way without a fix." }),
  inbox("office-route", "Route started (office)", "Laundry route started without a location fix", "{{personName}} started their laundry route without a location fix ({{errorLabel}}). Reason given: \"{{reason}}\".", { note: "To the office, when a driver starts a route without a fix." }),
]);

export const CLOCK_CHANGES_WORDING = editable("job.clock_changes", [
  inbox("auto-clock-out", "Auto clock-out", "Auto clocked out", "{{jobNumber}}: {{propertyName}} was automatically clocked out at {{time}}.", { required: ["jobNumber"], note: "To the cleaner, when the clock ran past the auto clock-out limit." }),
  inbox("left-site", "Left the site (cleaner)", "Clocked out — left job site", "You've been clocked out — you left the job site. Resume the job if this was a mistake.", { note: "To the cleaner." }),
  inbox("left-site-office", "Left the site (office)", "Cleaner auto clocked out (left site)", "{{cleanerName}} left the site at {{jobLabel}} (~{{distance}}m away) and was clocked out automatically.", { required: ["jobLabel"], note: "To administrators." }),
  inbox("auto-paused", "Auto-paused", "Job auto-paused", "{{jobNumber}}: {{propertyName}} ran for over 24 hours and was automatically paused. Please open it and submit your checklist, or resume if you're still on site.", { required: ["jobNumber"], note: "To the assigned cleaners; also sent as a browser push." }),
  inbox("times-edited", "Clock times edited", "Clock times updated by admin", "{{jobNumber}}: An admin amended your recorded clock times{{segmentTotal}}.", { required: ["jobNumber"], note: "To the cleaner whose times were edited." }),
  line("segment-total", "New segment total", "INBOX", " (new segment total: {{minutes}} minutes)", "Added when the edited segment has a duration."),
]);
