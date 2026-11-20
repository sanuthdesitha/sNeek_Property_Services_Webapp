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
