/**
 * Release notes for pages that have a tour (plain module). Every visible
 * change to such a page is listed here in the same change, against the tour
 * step that teaches it (a What's new step) or with a "no visible change"
 * reason. Settings › System › Tutorials shows this list beside the tours, so
 * an administrator can check that nothing shipped without a tutorial.
 */

export type ReleaseItem = {
  change: string;
  /** The tour, version and step that cover the change. */
  covered?: { tourKey: string; version: number; stepIds: string[] };
  /** Why no tour change was needed (same screen, speed only, wording only). */
  noVisibleChange?: string;
};

export type ReleaseNote = {
  release: string;
  /** Calendar day, yyyy-MM-dd. */
  date: string;
  author: string;
  items: ReleaseItem[];
};

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    release: "2026.11.28-cleaner-job-flow-v2",
    date: "2026-11-28",
    author: "Cleaner job flow v2 (pilots)",
    items: [
      { change: "Settings › System › Pilot features: switch new behaviours off, on, or on for chosen people or properties.", noVisibleChange: "A new settings page with no tour; the Settings hub list gains one row." },
      { change: "Pilot New cleaner job flow: while Looks unused waits for the office, Before you submit says Waiting for the office and the job cannot be submitted.", noVisibleChange: "Only on the real job page with the pilot on; the practice job has no pilots." },
      { change: "Pilot New cleaner job flow: Before you submit lists missing items by room, with Camera not working — ask the office; the office allows or declines on the job page.", noVisibleChange: "Only on the real job page with the pilot on (the practice job has no pilots), and on the admin job page, which has no tour." },
      { change: "Pilot New cleaner job flow: the checklist stays locked until the arrival video is uploaded, then rooms are worked one at a time (\"Kitchen · 3 of 12\") with what is still missing.", noVisibleChange: "Only on the real job page with the pilot on; the practice job (the toured page) has no pilots and is unchanged." },
    ],
  },
  {
    release: "2026.11.28-turnover-v4-plants-unused",
    date: "2026-11-28",
    author: "Turnover v4, live plants, looks unused",
    items: [
      { change: "Approvals has a Looks unused queue: a cleaner at a turnover that looks unused waits for Clean as normal, Light refresh only or Do not clean, with an optional note.", covered: { tourKey: "admin.approvals", version: 3, stepIds: ["unusedChecks"] } },
      { change: "The cleaner's job + menu has Looks unused — ask the office; the question and the office's answer show on the job screen.", noVisibleChange: "The real job page has no tour; the practice job does not show the + menu." },
      { change: "The start briefing lists \"This property has live plants…\" at properties marked with live plants.", noVisibleChange: "The start briefing dialog is on the real job page, which has no tour." },
      { change: "Property page: Plants marker in the header and a Plants line in Details; Checklist › Amenities explains the live plants switch.", noVisibleChange: "The property page has no tour." },
    ],
  },
  {
    release: "2026.11.23-xero-client-invoice-accounts",
    date: "2026-11-23",
    author: "Xero accounts for client invoices and shopping",
    items: [
      { change: "The invoice's Xero card lists the Xero account each kind of line goes to (sales, repairs, shopping, disbursements, credit notes), or why the push is refused when no sales account is chosen.", covered: { tourKey: "admin.finance.send", version: 5, stepIds: ["xeroAccounts"] } },
      { change: "Settings › Money › Xero: a Client invoices card holds the sales, repairs, shopping recharges, credit notes and agency disbursements accounts; the Invoice defaults card no longer shows the two account fields.", noVisibleChange: "Settings › Xero has no tour; recorded here so the change is listed." },
    ],
  },
  {
    release: "2026.11.23-cleaner-invoice-amendments",
    date: "2026-11-23",
    author: "Cleaner invoice amendments, one-off jobs, Xero cleaner bill accounts",
    items: [
      { change: "Pay › Invoices: an invoice the office amended shows \"Amended by the office\" with each change, the original and amended totals, the reason and the amended PDF.", covered: { tourKey: "cleaner.payRequests", version: 3, stepIds: ["amended"] } },
      { change: "Invoices and pay › Cleaner invoices: rows show \"Amended by the office\" and \"Needs updating in Xero\" pills.", noVisibleChange: "Two status pills on the Cleaner invoices tab only; the Send tour's steps and targets (client invoices) are unchanged." },
      { change: "New invoice refuses \"Unassigned / One-off Jobs\" with a reason saying how to attach each one-off site to its client.", noVisibleChange: "An error message in the existing New invoice preview, shown only for that catch-all client; no control was added or moved." },
    ],
  },
  {
    release: "2026.11.20-property-devices",
    date: "2026-11-20",
    author: "Property devices: Ring, Minut and charge tasks",
    items: [
      { change: "A device charge task shows first on the cleaner's job as High priority; it needs a photo when done, or a reason (with quick picks) when it could not be done, before the job can be submitted.", covered: { tourKey: "cleaner.job.practice", version: 2, stepIds: ["checklist"] } },
      { change: "The Properties item in the admin menu shows how many devices need charging.", noVisibleChange: "A count badge on an existing menu item, the same badge other items carry; no control was added or moved on a toured page." },
    ],
  },
  {
    release: "2026.11.20-lost-found-returns",
    date: "2026-11-20",
    author: "Lost and found: guest link and return requests",
    items: [
      { change: "Clients have a Lost and found page (Your homes) listing items found at their properties and each guest's return request; they can recommend a request.", covered: { tourKey: "welcome.client", version: 2, stepIds: ["lostFound"] } },
    ],
  },
  {
    release: "2026.11.18-pay-requests",
    date: "2026-11-18",
    author: "Pay requests: link, settle, bill the client",
    items: [
      { change: "The pay request panel states whether approving also bills the client, and for how much; it can be switched off for one request.", covered: { tourKey: "admin.approvals", version: 2, stepIds: ["clientBilling"] } },
      { change: "Full details of a pay request (job, decision, where it was paid, client billing, history) with edit, link to a job and mark paid, in Approvals and Decided.", covered: { tourKey: "admin.approvals", version: 2, stepIds: ["decided"] } },
      { change: "Client invoice job lines can carry approved extras: one line, combined total, the extras listed in the description.", covered: { tourKey: "admin.finance.send", version: 4, stepIds: ["lines"] } },
      { change: "A cleaner's pay requests show where each was paid and its history.", covered: { tourKey: "cleaner.payRequests", version: 2, stepIds: ["list"] } },
    ],
  },
  {
    release: "2026.11.18-xero-update",
    date: "2026-11-18",
    author: "Xero grouping and Update in Xero",
    items: [
      { change: "The invoice Xero card gains Update in Xero for an invoice or credit note already in Xero: it re-sends the lines, grouped by property like the PDF, to the same Xero document.", covered: { tourKey: "admin.finance.send", version: 3, stepIds: ["xeroUpdate"] } },
      { change: "The invoice list's row menu offers Update in Xero on rows already in Xero with no payment recorded.", covered: { tourKey: "admin.finance.send", version: 3, stepIds: ["xeroUpdate"] } },
      { change: "An invoice in Xero that is still a draft or approved can have its line order changed (Group by property, or drag within a property); amounts stay locked.", covered: { tourKey: "admin.finance.send", version: 3, stepIds: ["xeroUpdate"] } },
      { change: "Every push to Xero now sends lines in the PDF's property grouping, whichever screen started it.", noVisibleChange: "Changes what Xero receives, not this screen." },
    ],
  },
  {
    release: "2026.11.17-guest-timing",
    date: "2026-11-17",
    author: "Guest timing tags and confirmation",
    items: [
      { change: "Jobs rows, phone cards and board cards say late checkout and early check-in in words (\"Late checkout · start after 11:00\"), instead of EARLY / LATE chips.", covered: { tourKey: "admin.jobs", version: 3, stepIds: ["timing"] } },
      { change: "Command lists today's guest timing under the Today by cleaner bars, and the table view gains a Guest timing column.", covered: { tourKey: "admin.command", version: 2, stepIds: ["guestTiming"] } },
      { change: "Offer cards on the cleaner's Today screen show the guest timing before Accept.", covered: { tourKey: "cleaner.today", version: 2, stepIds: ["offerTiming"] } },
    ],
  },
  {
    release: "2026.11.17-qa-maintenance-tours",
    date: "2026-11-17",
    author: "QA and Maintenance page tours",
    items: [
      { change: "QA Today page tour: figures, visit order (locked when the office set it), starting the next inspection, All inspections.", covered: { tourKey: "qa.today", version: 1, stepIds: ["figures", "visitOrder", "start", "queue", "help"] } },
      { change: "QA inspection page tour: the three steps, the cleaner's photos, damage, grading, rework, pass or fail, AI suggestions.", covered: { tourKey: "qa.inspection", version: 1, stepIds: ["steps", "submitted", "inspect", "grade", "rework", "result", "aiReview"] } },
      { change: "QA Reviews (history) page tour.", covered: { tourKey: "qa.reviews", version: 1, stepIds: ["row", "verdict", "open"] } },
      { change: "Maintenance Today page tour: Accept or Can't take it, Other price, Due today.", covered: { tourKey: "maintenance.today", version: 1, stepIds: ["newAssignment", "price", "due", "help"] } },
      { change: "Maintenance Tickets page tour: by day (today, later, overdue while open) or by stage.", covered: { tourKey: "maintenance.tickets", version: 1, stepIds: ["view", "filters", "days", "card"] } },
      { change: "Maintenance ticket visit page tour: stages, issue, cost, access, travel, clock in, finish photos, complete.", covered: { tourKey: "maintenance.visit", version: 1, stepIds: ["stages", "issue", "cost", "access", "travel", "clockIn", "photos", "complete"] } },
      { change: "The QA and Maintenance welcome screens are unchanged; their Today pages now carry the new tours' controls.", noVisibleChange: "Only data-tour markers were added on Today; recorded for welcome.qa and welcome.maintenance with the script's no-visible-change reason." },
    ],
  },
  {
    release: "2026.11.16-everyday-dialogs",
    date: "2026-11-16",
    author: "Everyday dialogs and sheets",
    items: [
      { change: "One Assign window for Jobs quick assign, the bulk bar, the job page and the Calendar; leave and expired police checks or visas show in the list before saving.", covered: { tourKey: "admin.jobs", version: 2, stepIds: ["unassigned"] } },
      { change: "Record payment window: money facts first and a plain line that nothing is sent to Xero.", noVisibleChange: "Inside the Record payment window only; the Send tour's steps and targets are unchanged." },
      { change: "The admin rail no longer starts with only My profile while permissions load.", noVisibleChange: "Fix: the rail shows the same entries as before, without the empty first moment." },
    ],
  },
  {
    release: "2026.11.16-delivery",
    date: "2026-11-16",
    author: "Delivery profiles",
    items: [
      { change: "The invoice Send box has a Change recipients link to the client's delivery profile (who gets its invoices and reports).", covered: { tourKey: "admin.finance.send", version: 2, stepIds: ["send"] } },
    ],
  },
  {
    release: "2026.11.16",
    date: "2026-11-16",
    author: "Tutorials launch",
    items: [
      { change: "Help (?) added to every portal header: replay this page's tour, walkthroughs, Show tours.", noVisibleChange: "New feature: the tours themselves are its introduction." },
      { change: "Welcome screens for every role on first sign-in.", covered: { tourKey: "welcome.cleaner", version: 1, stepIds: ["hello", "three", "practice"] } },
      { change: "Command, Jobs and Approvals page tours for the office.", covered: { tourKey: "admin.jobs", version: 1, stepIds: ["filters", "unassigned", "row", "bulk", "new"] } },
      { change: "Practice walkthroughs: create a job, send an invoice, a cleaner's job from offer to submit, a laundry pickup.", covered: { tourKey: "cleaner.job.practice", version: 1, stepIds: ["accept", "submit"] } },
    ],
  },
];
