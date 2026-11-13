/**
 * The live-location section shown on both public privacy pages, after the
 * owner-editable sections (it states what the app actually does, so it is
 * not editable text). Plain module: server pages read it directly.
 */
export const LOCATION_PRIVACY_SECTION = {
  title: "Location of our staff while they work",
  body:
    "Our cleaners and laundry drivers use the sNeek app at work. While they work, the app shares their phone's location with our office so we can coordinate jobs, confirm arrival at the right property and stop a clock left running after someone leaves a site.",
  bullets: [
    "Cleaners: from when they set off to a job (\"On my way\") until they clock out of it, on that day's job only. Never while their clock is stopped, and never on other days.",
    "Laundry drivers: only while their laundry route for the day is active.",
    "Each person reads and accepts a notice explaining this before their first start, and their phone shows that their location is being shared for the whole time it is.",
    "Who sees it: our office (administrators and operations managers). A client sees their cleaner's position only while the cleaner is on the way, and only if we have switched this on for that client; the cleaner is told when it is on.",
    "Location history is kept for 7 days and then deleted. The position at clock-in and clock-out is kept with the job's time records. Viewing a person's movement trail is recorded.",
    "Location is never recorded while one of our administrators is viewing the app as that person.",
  ],
} as const;
