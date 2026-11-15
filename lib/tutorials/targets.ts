/**
 * The tour target registry (plain module: safe for server pages).
 *
 * Every control a tour can point at is named here with a stable id, the page
 * (route pattern) it belongs to and a human label. The control itself carries
 * the id through `tourTarget(id)`, which spreads a single `data-tour`
 * attribute and nothing else, so adding a target never changes behaviour,
 * styling or accessible names.
 *
 * Tours never use free CSS selectors. A renamed or removed control breaks
 * `tests/lib/tutorials-targets.test.ts` (it scans the source for these ids)
 * instead of silently breaking a tour.
 */

export type TourPortal = "admin" | "cleaner" | "client" | "laundry" | "qa" | "maintenance";

export type TourTargetInfo = {
  /** Route pattern of the page the control lives on (`[id]` matches one segment). */
  page: string;
  /** Plain description shown on the Tutorials settings screen. */
  label: string;
  portal: TourPortal;
};

export const TOUR_TARGETS = {
  // Help buttons in each portal header (components/v2/tutorials/help-button.tsx).
  "admin.nav.help": { page: "*", label: "Help button", portal: "admin" },
  "cleaner.header.help": { page: "*", label: "Help button", portal: "cleaner" },
  "client.header.help": { page: "*", label: "Help button", portal: "client" },
  "laundry.header.help": { page: "*", label: "Help button", portal: "laundry" },
  "qa.header.help": { page: "*", label: "Help button", portal: "qa" },
  "maintenance.header.help": { page: "*", label: "Help button", portal: "maintenance" },

  // Admin · Command (/v2/admin)
  "admin.command.greeting": { page: "/v2/admin", label: "Date and summary heading", portal: "admin" },
  "admin.command.tiles": { page: "/v2/admin", label: "Live counters", portal: "admin" },
  "admin.command.needsYou": { page: "/v2/admin", label: "Work queue (needs you now)", portal: "admin" },
  "admin.command.today": { page: "/v2/admin", label: "Today by cleaner", portal: "admin" },

  // Admin · Jobs (/v2/admin/jobs)
  "admin.jobs.filters": { page: "/v2/admin/jobs", label: "Filter bar", portal: "admin" },
  "admin.jobs.unassigned": { page: "/v2/admin/jobs", label: "Needs a cleaner view", portal: "admin" },
  "admin.jobs.row": { page: "/v2/admin/jobs", label: "Jobs table", portal: "admin" },
  "admin.jobs.bulk": { page: "/v2/admin/jobs", label: "Select several jobs", portal: "admin" },
  "admin.jobs.new": { page: "/v2/admin/jobs", label: "New job button", portal: "admin" },

  // Admin · Create a job, practice (/v2/admin/jobs/practice renders the real form)
  "admin.jobs.create.property": { page: "/v2/admin/jobs/practice", label: "Property field", portal: "admin" },
  "admin.jobs.create.service": { page: "/v2/admin/jobs/practice", label: "Service field", portal: "admin" },
  "admin.jobs.create.when": { page: "/v2/admin/jobs/practice", label: "Date and time fields", portal: "admin" },
  "admin.jobs.create.cleaner": { page: "/v2/admin/jobs/practice", label: "Cleaner choice", portal: "admin" },
  "admin.jobs.create.submit": { page: "/v2/admin/jobs/practice", label: "Create job button", portal: "admin" },

  // Admin · Send an invoice (list, then the real editor with a practice invoice)
  "admin.finance.invoices.list": { page: "/v2/admin/finance", label: "Invoice list (Invoices tab)", portal: "admin" },
  "admin.finance.invoice.lines": { page: "/v2/admin/finance/invoices/practice", label: "Invoice lines", portal: "admin" },
  "admin.finance.invoice.preview": { page: "/v2/admin/finance/invoices/practice", label: "Send card (who gets it)", portal: "admin" },
  "admin.finance.invoice.send": { page: "/v2/admin/finance/invoices/practice", label: "Send button", portal: "admin" },
  "admin.finance.invoice.status": { page: "/v2/admin/finance/invoices/practice", label: "Stage bar", portal: "admin" },

  // Admin · Approvals (/v2/admin/approvals)
  "admin.approvals.queues": { page: "/v2/admin/approvals", label: "Queue list", portal: "admin" },
  "admin.approvals.list": { page: "/v2/admin/approvals", label: "Selected queue", portal: "admin" },
  "admin.approvals.decided": { page: "/v2/admin/approvals", label: "Waiting / Decided switch", portal: "admin" },

  // Cleaner · Today (/v2/cleaner)
  "cleaner.today.clock": { page: "/v2/cleaner", label: "Clocked in or not", portal: "cleaner" },
  "cleaner.today.nextJob": { page: "/v2/cleaner", label: "Next job card", portal: "cleaner" },
  "cleaner.today.offer": { page: "/v2/cleaner", label: "Offer card", portal: "cleaner" },
  "cleaner.tabs.pay": { page: "*", label: "Pay tab", portal: "cleaner" },

  // Cleaner · practice job (/v2/cleaner/jobs/practice renders the real job stages)
  "cleaner.offer.accept": { page: "/v2/cleaner/jobs/practice", label: "Accept job button", portal: "cleaner" },
  "cleaner.job.startDriving": { page: "/v2/cleaner/jobs/practice", label: "Start driving", portal: "cleaner" },
  "cleaner.job.checkIn": { page: "/v2/cleaner/jobs/practice", label: "Check in on site", portal: "cleaner" },
  "cleaner.job.locationNotice": { page: "/v2/cleaner/jobs/practice", label: "Location off notice", portal: "cleaner" },
  "cleaner.job.checklistItem": { page: "/v2/cleaner/jobs/practice", label: "Checklist", portal: "cleaner" },
  "cleaner.job.photoStrip": { page: "/v2/cleaner/jobs/practice", label: "Stamped photos", portal: "cleaner" },
  "cleaner.job.submit": { page: "/v2/cleaner/jobs/practice", label: "Submit job", portal: "cleaner" },
  "cleaner.job.extraPay": { page: "/v2/cleaner/jobs/practice", label: "Ask for extra pay", portal: "cleaner" },

  // Cleaner · Pay requests (/v2/cleaner/pay-requests)
  "cleaner.payRequests.new": { page: "/v2/cleaner/pay", label: "New request button (Pay › Requests)", portal: "cleaner" },
  "cleaner.payRequests.list": { page: "/v2/cleaner/pay", label: "Your requests (Pay › Requests)", portal: "cleaner" },

  // Client · Approvals (/v2/client/approvals) and the quote practice
  "client.tabs.approvals": { page: "*", label: "Approvals tab", portal: "client" },
  "client.approvals.card": { page: "/v2/client/approvals", label: "Approval card", portal: "client" },
  "client.approvals.quote": { page: "/v2/client/approvals", label: "Quote waiting", portal: "client" },

  // Client · a clean's report (/v2/client/jobs/[id])
  "client.report.checklist": { page: "/v2/client/jobs/[id]", label: "Checklist and issues", portal: "client" },
  "client.report.photos": { page: "/v2/client/jobs/[id]", label: "Stamped photos", portal: "client" },
  "client.report.share": { page: "/v2/client/jobs/[id]", label: "Download or share", portal: "client" },

  // Laundry · Today (/v2/laundry) and the practice stop
  "laundry.today.route": { page: "/v2/laundry", label: "Today's stops", portal: "laundry" },
  "laundry.today.stop": { page: "/v2/laundry", label: "Next stop", portal: "laundry" },
  "laundry.stop.confirm": { page: "/v2/laundry/stop/practice", label: "Confirm pickup", portal: "laundry" },
  "laundry.stop.count": { page: "/v2/laundry/stop/practice", label: "Bag count", portal: "laundry" },
  "laundry.stop.failed": { page: "/v2/laundry/stop/practice", label: "Failed pickup", portal: "laundry" },
} as const satisfies Record<string, TourTargetInfo>;

export type TourTargetId = keyof typeof TOUR_TARGETS;

/** The one attribute a target carries. Spread it onto the real control. */
export type TourTargetProps = { "data-tour": TourTargetId };

export function tourTarget(id: TourTargetId): TourTargetProps {
  return { "data-tour": id };
}

export function isTourTargetId(value: string): value is TourTargetId {
  return Object.prototype.hasOwnProperty.call(TOUR_TARGETS, value);
}

/** Targets that belong to a page (the Tutorials editor lists these). */
export function targetsForPage(page: string): TourTargetId[] {
  return (Object.keys(TOUR_TARGETS) as TourTargetId[]).filter((id) => TOUR_TARGETS[id].page === page);
}

/** The Help button's target in each portal header (one literal call each, so the source scan sees them). */
export const HELP_TARGET_BY_PORTAL: Record<TourPortal, TourTargetProps> = {
  admin: tourTarget("admin.nav.help"),
  cleaner: tourTarget("cleaner.header.help"),
  client: tourTarget("client.header.help"),
  laundry: tourTarget("laundry.header.help"),
  qa: tourTarget("qa.header.help"),
  maintenance: tourTarget("maintenance.header.help"),
};
