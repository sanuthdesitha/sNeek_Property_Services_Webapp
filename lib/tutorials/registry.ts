/**
 * The tour registry (plain module: safe for server pages and API routes).
 *
 * Wording follows the approved boards "Tutorials", "Admin tours", "Phone tours"
 * and "Tutorials settings" (2026-11) exactly where the boards give it. Steps the
 * boards only name (welcome screens for roles other than cleaners, admin
 * Approvals, cleaner Pay requests, the client quote practice) were written to
 * the same rules: a 2-4 word title, at most 25 words, second person, one idea.
 *
 * Changing a page that has a tour? Update the tour in the same change: bump
 * `version`, set `since` on the changed or new steps (they become What's new),
 * and update lib/tutorials/fingerprints.json. See AGENTS.md › Tutorials.
 */
import type { TourDefinition, TourRole } from "./types";

const ADMIN_OFFICE: TourRole[] = ["ADMIN", "OPS_MANAGER"];

export const TOURS: readonly TourDefinition[] = [
  /* ── Welcome screens (first sign-in, one per portal) ──────────────────── */
  {
    key: "welcome.admin",
    kind: "welcome",
    portal: "admin",
    roles: ["ADMIN"],
    route: "/v2/admin",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "command", target: null, since: 1, title: "Welcome to sNeek", body: "Command is your start page: today's work, what needs a decision and what went wrong, most urgent first." },
      { id: "where", target: null, since: 1, title: "Where things live", body: "Jobs and Calendar plan the work. Invoices and pay holds the money. Settings holds everything you set up once." },
      { id: "pin", target: null, since: 1, title: "Your PIN", body: "Sensitive actions, like voiding an invoice, ask for your own PIN. Set it in My profile before you need it." },
      {
        id: "start", target: null, since: 1, title: "Take the Command tour", body: "Five short steps on the real page. Skip any time; Help replays it.",
        actions: [
          { kind: "startTour", label: "Start the Command tour", tourKey: "admin.command", primary: true },
          { kind: "finish", label: "Not now" },
        ],
      },
    ],
  },
  {
    key: "welcome.ops",
    kind: "welcome",
    portal: "admin",
    roles: ["OPS_MANAGER"],
    route: "/v2/admin",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "welcome", target: null, since: 1, title: "Welcome to sNeek", body: "You run the day: jobs, cleaners, laundry and approvals, on the same pages the administrators use." },
      { id: "access", target: null, since: 1, title: "What you can reach", body: "Your access covers the areas an administrator gave you. Manage lets you change things; View lets you look." },
      { id: "jobs", target: null, since: 1, title: "Jobs and Live ops", body: "Jobs lists every clean and who is on it. Live ops shows who is on the way, on site or late." },
      {
        id: "start", target: null, since: 1, title: "Take the Jobs tour", body: "Five short steps on the real Jobs page. Skip any time; Help replays it.",
        actions: [
          { kind: "startTour", label: "Start the Jobs tour", tourKey: "admin.jobs", primary: true },
          { kind: "finish", label: "Not now" },
        ],
      },
    ],
  },
  {
    key: "welcome.cleaner",
    kind: "welcome",
    portal: "cleaner",
    roles: ["CLEANER"],
    route: "/v2/cleaner",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "hello", target: null, since: 1, title: "G'day {firstName}, welcome to sNeek", body: "This app is where your jobs, pay and supplies live. A quick look takes about a minute." },
      { id: "three", target: null, since: 1, title: "Three things matter", body: "Three things matter most: Today shows your next job, Jobs shows your week, Pay shows what you've earned." },
      {
        id: "practice", target: null, since: 1, title: "Want a practice run?",
        body: "Do a pretend job from offer to submit, on the real screens. Nothing is sent to anyone and nothing counts towards pay.",
        note: "We'll ask for location and notifications when a job needs them, not now.",
        actions: [
          { kind: "startTour", label: "Start practice job", tourKey: "cleaner.job.practice", primary: true },
          { kind: "navigate", label: "Go to Today", href: "/v2/cleaner" },
        ],
      },
    ],
  },
  {
    key: "welcome.client",
    kind: "welcome",
    portal: "client",
    roles: ["CLIENT"],
    route: "/v2/client",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "welcome", target: null, since: 1, title: "Welcome to sNeek", body: "This is where you see your properties, every clean we do and anything waiting for your decision." },
      { id: "cleans", target: null, since: 1, title: "Cleans and reports", body: "Each clean has a report: the checklist, stamped photos and any issues we found." },
      { id: "approvals", target: null, since: 1, title: "Approvals", body: "Anything that costs you more waits for your yes. Nothing is charged without your yes." },
      {
        id: "messages", target: null, since: 1, title: "Messages", body: "Questions or changes? Message us from Messages and we'll reply there. Help replays these tips.",
        actions: [{ kind: "navigate", label: "Go to Home", href: "/v2/client", primary: true }],
      },
    ],
  },
  {
    key: "welcome.va",
    kind: "welcome",
    portal: "client",
    roles: ["VA"],
    route: "/v2/client",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "welcome", target: null, since: 1, title: "Welcome to sNeek", body: "You're helping a client run their properties, with the access they chose for you." },
      { id: "access", target: null, since: 1, title: "What you can do", body: "You see only the pages your client shared with you. Approving money stays with the client." },
      {
        id: "home", target: null, since: 1, title: "Go to Home", body: "Home shows today's cleans and anything that needs a look. Help replays these tips.",
        actions: [{ kind: "navigate", label: "Go to Home", href: "/v2/client", primary: true }],
      },
    ],
  },
  {
    key: "welcome.laundry",
    kind: "welcome",
    portal: "laundry",
    roles: ["LAUNDRY"],
    route: "/v2/laundry",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "welcome", target: null, since: 1, title: "Welcome to sNeek", body: "Your runs, stops and history live here, in the order you drive them." },
      { id: "run", target: null, since: 1, title: "Today's run", body: "Today's run lists your stops in route order. The top one is next." },
      { id: "confirm", target: null, since: 1, title: "Confirm pickups", body: "At each stop, confirm it's ready, count the bags and take a photo. The office sees it straight away." },
      {
        id: "practice", target: null, since: 1, title: "Practice a stop", body: "Try a practice stop first. Nothing is sent, and no run or count changes.",
        actions: [
          { kind: "startTour", label: "Start practice stop", tourKey: "laundry.pickup.practice", primary: true },
          { kind: "navigate", label: "Go to Today", href: "/v2/laundry" },
        ],
      },
    ],
  },
  {
    key: "welcome.qa",
    kind: "welcome",
    portal: "qa",
    roles: ["QA_INSPECTOR"],
    route: "/v2/qa",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "welcome", target: null, since: 1, title: "Welcome to sNeek", body: "Your inspections, rework and pay live here." },
      { id: "waiting", target: null, since: 1, title: "Inspections waiting", body: "Today lists the inspections waiting for you, in visit order. Open one to start." },
      {
        id: "scoring", target: null, since: 1, title: "Scoring and photos", body: "Score each area and mark the photos that show a problem. The cleaner sees your result after you submit.",
        actions: [{ kind: "finish", label: "Go to Today", primary: true }],
      },
    ],
  },
  {
    key: "welcome.maintenance",
    kind: "welcome",
    portal: "maintenance",
    roles: ["MAINTENANCE"],
    route: "/v2/maintenance",
    title: "Welcome",
    version: 1,
    steps: [
      { id: "welcome", target: null, since: 1, title: "Welcome to sNeek", body: "Your tickets, visits and replacements live here." },
      { id: "tickets", target: null, since: 1, title: "Your tickets", body: "Tickets lists the work assigned to you, most urgent first. Open one for the details and history." },
      {
        id: "visits", target: null, since: 1, title: "Visits and photos", body: "Log each visit with photos before and after, so the office can close the ticket.",
        actions: [{ kind: "navigate", label: "Go to Tickets", href: "/v2/maintenance/tickets", primary: true }],
      },
    ],
  },

  /* ── Admin and operations managers ─────────────────────────────────────── */
  {
    key: "admin.command",
    kind: "page",
    portal: "admin",
    roles: ADMIN_OFFICE,
    route: "/v2/admin",
    title: "Command",
    version: 1,
    steps: [
      { id: "greeting", target: "admin.command.greeting", since: 1, title: "Your start page", body: "This is Command, your start page. It shows what needs you today, most urgent first." },
      { id: "tiles", target: "admin.command.tiles", since: 1, title: "Live counts", body: "These counts are live. Click one to open the list behind it, already filtered." },
      { id: "needsYou", target: "admin.command.needsYou", since: 1, title: "Needs you now", body: "Approvals, late cleaners and failed sends land here. Clear these first; each row opens where you fix it." },
      { id: "today", target: "admin.command.today", since: 1, title: "Today's jobs", body: "Today's jobs in time order. A word like Late or Not started tells you something's wrong." },
      { id: "help", target: "admin.nav.help", since: 1, title: "Lost?", body: "Lost? Help replays this tour and lists the walkthroughs for every page." },
    ],
  },
  {
    key: "admin.jobs",
    kind: "page",
    portal: "admin",
    roles: ADMIN_OFFICE,
    route: "/v2/admin/jobs",
    title: "Jobs",
    version: 1,
    offerWalkthrough: "admin.jobs.create",
    steps: [
      { id: "filters", target: "admin.jobs.filters", since: 1, title: "Find the right jobs", body: "Filter by day, status or cleaner. Your last filter is remembered on this device." },
      { id: "unassigned", target: "admin.jobs.unassigned", since: 1, title: "Unassigned jobs", body: "Unassigned jobs wait here. Assign them before offers close at 6:00 pm the day before." },
      { id: "row", target: "admin.jobs.row", since: 1, title: "Open a job", body: "Click a job to open its full page: checklist, photos, money and history." },
      { id: "bulk", target: "admin.jobs.bulk", since: 1, title: "Several at once", body: "Tick several jobs to assign, move or message them together." },
      { id: "new", target: "admin.jobs.new", since: 1, title: "New job", body: "New job makes a one-off job. Bookings from iCal appear on their own." },
    ],
  },
  {
    key: "admin.jobs.create",
    kind: "walkthrough",
    portal: "admin",
    roles: ADMIN_OFFICE,
    route: "/v2/admin/jobs/practice",
    title: "Create a job",
    version: 1,
    practice: { banner: "Practice · nothing is saved and no offer is sent", exitHref: "/v2/admin/jobs" },
    steps: [
      { id: "property", target: "admin.jobs.create.property", since: 1, practice: true, title: "Pick the property", body: "Pick the property. Its checklist, access notes and price list come with it." },
      { id: "service", target: "admin.jobs.create.service", since: 1, practice: true, title: "Choose the service", body: "Choose the service. The price comes from the client's price list." },
      { id: "when", target: "admin.jobs.create.when", since: 1, practice: true, title: "Set the time", body: "Set the date and time. Guest check-out and the next check-in are shown to help." },
      { id: "cleaner", target: "admin.jobs.create.cleaner", since: 1, practice: true, title: "Offer to a cleaner", body: "Suggested cleaners are free and nearby. Picking one sends them an offer, not a booking." },
      { id: "submit", target: "admin.jobs.create.submit", since: 1, practice: true, title: "Create the job", body: "Create job. In practice nothing is saved and no offer is sent." },
    ],
  },
  {
    key: "admin.finance.send",
    kind: "walkthrough",
    portal: "admin",
    roles: ADMIN_OFFICE,
    route: "/v2/admin/finance?tab=invoices",
    title: "Send an invoice",
    version: 1,
    practice: { banner: "Practice · nothing is emailed or sent to Xero", exitHref: "/v2/admin/finance?tab=invoices" },
    steps: [
      { id: "list", target: "admin.finance.invoices.list", since: 1, requiresHref: "/v2/admin/finance?tab=invoices", title: "Drafts to check", body: "Draft invoices are ready to check. Each lists the cleans it covers." },
      { id: "lines", target: "admin.finance.invoice.lines", since: 1, practice: true, route: "/v2/admin/finance/invoices/practice", title: "Where lines come from", body: "Line items come from completed jobs and the client's rates. To change one, fix the job, not the total." },
      { id: "preview", target: "admin.finance.invoice.preview", since: 1, practice: true, route: "/v2/admin/finance/invoices/practice", title: "What the client sees", body: "This is the email the client gets, with the PDF attached." },
      { id: "send", target: "admin.finance.invoice.send", since: 1, practice: true, route: "/v2/admin/finance/invoices/practice", requiresManageHref: "/v2/admin/finance?tab=invoices", title: "Send to the client", body: "Send to client. In practice it goes nowhere; for real it's emailed and sent to Xero." },
      { id: "status", target: "admin.finance.invoice.status", since: 1, practice: true, route: "/v2/admin/finance/invoices/practice", title: "Sent isn't paid", body: "Sent isn't paid. It turns Paid only when the payment or Xero confirms it." },
    ],
  },
  {
    key: "admin.approvals",
    kind: "page",
    portal: "admin",
    roles: ADMIN_OFFICE,
    route: "/v2/admin/approvals",
    title: "Approvals",
    version: 1,
    steps: [
      { id: "queues", target: "admin.approvals.queues", since: 1, title: "Approval queues", body: "Each queue holds one kind of decision, with a live count. Pick one to see what's waiting." },
      { id: "list", target: "admin.approvals.list", since: 1, title: "Decide here", body: "Open a row to see the details and decide. Pay and charges change only when you approve." },
      { id: "decided", target: "admin.approvals.decided", since: 1, title: "Decided", body: "Decided shows what was approved or declined, by whom and when." },
    ],
  },

  /* ── Cleaners ──────────────────────────────────────────────────────────── */
  {
    key: "cleaner.today",
    kind: "page",
    portal: "cleaner",
    roles: ["CLEANER"],
    route: "/v2/cleaner",
    title: "Today",
    version: 1,
    offerWalkthrough: "cleaner.job.practice",
    steps: [
      { id: "clock", target: "cleaner.today.clock", since: 1, title: "Clocked in or not", body: "This shows if you're clocked in. You clock in on site, not at home." },
      { id: "nextJob", target: "cleaner.today.nextJob", since: 1, title: "Your next job", body: "Your next job, with the time and address. Tap Open job when you're ready to start." },
      { id: "offer", target: "cleaner.today.offer", since: 1, title: "New offers", body: "New offers wait here. Accept or decline; the office plans around your answer." },
      { id: "pay", target: "cleaner.tabs.pay", since: 1, title: "Your pay", body: "Pay shows what you've earned, worked out from the office's rates." },
      { id: "help", target: "cleaner.header.help", since: 1, title: "Help any time", body: "Tap ? any time to replay this tour or practise a job." },
    ],
  },
  {
    key: "cleaner.job.practice",
    kind: "walkthrough",
    portal: "cleaner",
    roles: ["CLEANER"],
    route: "/v2/cleaner/jobs/practice",
    title: "Practice job, offer to submit",
    version: 1,
    practice: { banner: "Practice · nothing is sent", exitHref: "/v2/cleaner" },
    steps: [
      { id: "accept", target: "cleaner.offer.accept", since: 1, practice: true, practiceState: "accept", title: "Accept the job", body: "Accepting adds the job to your day. Access details unlock once you accept." },
      { id: "startDriving", target: "cleaner.job.startDriving", since: 1, practice: true, practiceState: "travel", title: "On your way", body: "Tap Start driving when you leave. The office sees you're on the way." },
      { id: "checkIn", target: "cleaner.job.checkIn", since: 1, practice: true, practiceState: "setup", title: "Check in on site", body: "Check in when you arrive. Clocking in records your time and location, to confirm you're at the property." },
      { id: "locationNotice", target: "cleaner.job.locationNotice", since: 1, practice: true, practiceState: "setup", title: "No location fix?", body: "No location fix on site? You can still start: say why, and the office reviews it." },
      { id: "checklist", target: "cleaner.job.checklistItem", since: 1, practice: true, practiceState: "clean", title: "Room by room", body: "Work through the checklist room by room. Each item needs a tick, or a reason why not." },
      { id: "photos", target: "cleaner.job.photoStrip", since: 1, practice: true, practiceState: "clean", title: "Photos are stamped", body: "The app stamps each photo with the time and place. Take them in good light, whole room in view." },
      { id: "submit", target: "cleaner.job.submit", since: 1, practice: true, practiceState: "wrapup", title: "Submit and wait for the receipt", body: "Submit sends everything. Wait for the receipt number: that's your proof the office has it." },
      { id: "extraPay", target: "cleaner.job.extraPay", since: 1, practice: true, practiceState: "submitted", title: "Took longer?", body: "Took longer for a real reason? Ask for extra pay here, with a note and a photo." },
    ],
  },
  {
    key: "cleaner.payRequests",
    kind: "walkthrough",
    portal: "cleaner",
    roles: ["CLEANER"],
    route: "/v2/cleaner/pay?tab=requests",
    title: "Request extra pay",
    version: 1,
    steps: [
      { id: "new", target: "cleaner.payRequests.new", since: 1, title: "Ask for extra pay", body: "Took longer for a real reason? Ask for extra pay here, with a note and a photo." },
      { id: "list", target: "cleaner.payRequests.list", since: 1, title: "Your requests", body: "Each request shows whether the office approved it. Approved amounts appear in Pay." },
    ],
  },

  /* ── Clients and their assistants ──────────────────────────────────────── */
  {
    key: "client.approvals",
    kind: "page",
    portal: "client",
    roles: ["CLIENT", "VA"],
    route: "/v2/client/approvals",
    title: "Approvals",
    version: 1,
    steps: [
      { id: "tab", target: "client.tabs.approvals", since: 1, title: "Waiting for your yes", body: "Anything that costs you more waits here for your yes. We don't charge until you approve." },
      { id: "card", target: "client.approvals.card", since: 1, title: "What you're approving", body: "See what it's for, the price and the photos. Approve, decline, or ask us a question." },
      { id: "quote", target: "client.approvals.quote", since: 1, title: "Quotes", body: "Approving a quote books the work. You'll get a confirmation email." },
    ],
  },
  {
    key: "client.report",
    kind: "page",
    portal: "client",
    roles: ["CLIENT", "VA"],
    route: "/v2/client/jobs/[id]",
    title: "A clean's report",
    version: 1,
    steps: [
      { id: "checklist", target: "client.report.checklist", since: 1, title: "The report", body: "Each clean has a report: the checklist, photos and any issues we found." },
      { id: "photos", target: "client.report.photos", since: 1, title: "Stamped photos", body: "Photos show the time they were taken, so you can see the place was guest-ready." },
      { id: "share", target: "client.report.share", since: 1, title: "Download or share", body: "Download the report or share it with your co-host." },
    ],
  },

  /* ── Laundry partners ──────────────────────────────────────────────────── */
  {
    key: "laundry.today",
    kind: "page",
    portal: "laundry",
    roles: ["LAUNDRY"],
    route: "/v2/laundry",
    title: "Today's run",
    version: 1,
    offerWalkthrough: "laundry.pickup.practice",
    steps: [
      { id: "route", target: "laundry.today.route", since: 1, title: "Today's stops", body: "Today's stops in route order. The top one is next." },
      { id: "stop", target: "laundry.today.stop", since: 1, title: "Your next stop", body: "Each stop shows the bags expected and where they're left. Tap I'm here at the door." },
    ],
  },
  {
    key: "laundry.pickup.practice",
    kind: "walkthrough",
    portal: "laundry",
    roles: ["LAUNDRY"],
    route: "/v2/laundry/stop/practice",
    title: "Confirm a pickup",
    version: 1,
    practice: { banner: "Practice · nothing is sent", exitHref: "/v2/laundry" },
    steps: [
      { id: "confirm", target: "laundry.stop.confirm", since: 1, practice: true, title: "Confirm the pickup", body: "Confirm it's ready, count the bags and take a photo." },
      { id: "count", target: "laundry.stop.count", since: 1, practice: true, title: "Different count?", body: "Different count? Say why and add a photo. The office reviews it." },
      { id: "failed", target: "laundry.stop.failed", since: 1, practice: true, title: "Couldn't collect?", body: "Couldn't collect? Use Failed pickup and suggest a new time." },
    ],
  },
];

export function findTour(key: string): TourDefinition | undefined {
  return TOURS.find((tour) => tour.key === key);
}

/** Every tour a role may see (Help lists these, before permission skips). */
export function toursForRole(role: TourRole): TourDefinition[] {
  return TOURS.filter((tour) => tour.roles.includes(role));
}
