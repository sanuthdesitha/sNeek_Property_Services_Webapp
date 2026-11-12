/** Wording definitions for the office, laundry and stock types (catalog-office.ts). */
import type { TypeWordingDefinition } from "../types";
import { editable, emailTemplatePart, inCode, someParts, storePart } from "./build";

export const OFFICE_WORDING: readonly TypeWordingDefinition[] = [
  inCode("insights.monthly_email", "A generated report: tables of the month's figures built from the Insights data, not a message with fixed sentences."),
  inCode("office.cleaner_requests", "Several producers (continuations, early check-outs, clock adjustments, extra pay, availability) each compose the office notice from the request; not yet split into named parts."),
  inCode("office.field_alerts", "GPS, safety, maintenance and damage alerts are composed in their own services from the alert's data, with different sentences per alert kind; not yet split into named parts."),
  someParts("office.cases", [
    emailTemplatePart("created", "Case created", "caseCreated"),
    emailTemplatePart("updated", "Case updated", "caseUpdated"),
  ], "The inbox rows and the follow-up reminders are composed in lib/cases/notifications.ts and lib/cases/follow-up.ts; not yet moved."),
  inCode("office.client_requests", "Client booking requests and messages are composed from the request form's answers in the booking route; not yet split into named parts."),
  someParts("office.sla_and_summaries", [
    emailTemplatePart("attention", "Attention summary", "adminAttentionSummary"),
    emailTemplatePart("tomorrow-jobs", "Tomorrow's jobs", "tomorrowJobsSummary"),
    emailTemplatePart("tomorrow-laundry", "Tomorrow's laundry", "tomorrowLaundrySummary"),
  ], "SLA breach alerts and the daily briefing are composed in lib/ops/sla.ts and lib/ops/daily-briefing.ts from lists of jobs; not yet moved."),
  someParts("office.new_profile", [emailTemplatePart("office", "Office", "newProfileCreated")], "The inbox row is composed in lib/notifications/profile-created.ts; not yet moved."),
  inCode("office.reports_generated", "The inbox notice names the generated report and its share state, composed in lib/reports/admin-report-actions.ts; not yet moved."),
  someParts("laundry.updates", [
    emailTemplatePart("ready", "Laundry ready", "laundryReady"),
    emailTemplatePart("skip-requested", "Skip requested", "laundrySkipRequested"),
    emailTemplatePart("skip-approved", "Skip approved", "laundrySkipApproved"),
  ], "Status, catch-up and sync inbox notices are composed in three laundry services; not yet moved."),
  editable("laundry.failed_pickup", [
    storePart("rescheduled", "Rescheduled", "INBOX", {
      title: "Laundry pickup rescheduled",
      body: "{{propertyName}}: pickup rescheduled after failed attempt.",
    }, ["propertyName"], ["propertyName"], { note: "Inbox only, to the office." }),
    storePart("approval", "Approval requested", "INBOX", {
      title: "Laundry pickup approval requested",
      body: "{{propertyName}}: {{action}} approval requested after failed pickup.",
    }, ["propertyName", "action"], ["propertyName", "action"], { note: "{{action}} is \"skip\" or \"delete\". Inbox only, to the office." }),
  ]),
  someParts("laundry.report_email", [emailTemplatePart("recipient", "Report recipient", "laundryReport")], "The report attachment and its table are generated, not wording."),
  someParts("stock.alerts", [emailTemplatePart("office", "Office", "criticalInventoryTomorrow")], "Low-stock inbox rows are composed with the item list in lib/inventory/stock.ts, lib/ops/stock-alerts.ts and the scan-task route; not yet moved."),
  inCode("stock.submission_low_stock", "Built from the list of items a cleaner marked low in their submission; not yet split into named parts."),
  inCode("stock.urgent_need", "Three producers (urgent stock, submission urgent stock, stock-count observations) build the notice from the items, quantities and the job; not yet split into named parts."),
  someParts("stock.shopping_and_orders", [
    emailTemplatePart("run-submitted", "Shopping run submitted", "shoppingRunSubmitted"),
    emailTemplatePart("reimbursement", "Reimbursement to client", "shoppingReimbursementToClient"),
    emailTemplatePart("stock-run-requested", "Stock run requested", "stockRunRequested"),
    emailTemplatePart("stock-run-submitted", "Stock run submitted", "stockRunSubmitted"),
  ], "Purchase-order and inbox notices are composed in lib/inventory/notifications.ts; not yet moved."),
  inCode("maintenance.assignment", "Composed in the maintenance assignment flow from the job and its tasks; not yet split into named parts."),
  inCode("office.ical_alerts", "Composed from the sync result (which feed, how many bookings moved or failed) in lib/ical/notifications.ts; not yet split into named parts."),
  someParts("office.lost_found_report", [emailTemplatePart("office", "Office", "lostFoundAlert")], "The inbox row is composed in the cleaner lost-and-found route; not yet moved."),
];
