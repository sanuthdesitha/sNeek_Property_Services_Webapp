/** Wording definitions for the office, laundry and stock types (catalog-office.ts). */
import type { TypeWordingDefinition } from "../types";
import { editable, emailTemplatePart, inCode, notificationTemplateParts, someParts, storePart } from "./build";
import { SUBMISSION_LOW_STOCK_WORDING, URGENT_NEED_WORDING } from "./stock";
import { ICAL_ALERTS_WORDING, REPORTS_GENERATED_WORDING } from "./office-alerts";
import { MAINTENANCE_WORDING } from "./maintenance";
import { CASE_FOLLOW_UP_PARTS, NEW_PROFILE_PARTS, SLA_PARTS } from "./office-summaries";
import { FIELD_ALERTS_WORDING } from "./field-alerts";
import { CLEANER_REQUESTS_WORDING } from "./cleaner-requests";
import { CLIENT_REQUESTS_WORDING } from "./client-requests";

export const OFFICE_WORDING: readonly TypeWordingDefinition[] = [
  inCode("insights.monthly_email", "A generated report: tables of the month's figures built from the Insights data, not a message with fixed sentences."),
  CLEANER_REQUESTS_WORDING,
  FIELD_ALERTS_WORDING,
  editable("office.cases", [
    ...notificationTemplateParts("created", "Case created", "caseCreated"),
    emailTemplatePart("created", "Case created", "caseCreated"),
    ...notificationTemplateParts("updated", "Case updated", "caseUpdated"),
    emailTemplatePart("updated", "Case updated", "caseUpdated"),
    ...CASE_FOLLOW_UP_PARTS,
  ]),
  CLIENT_REQUESTS_WORDING,
  editable("office.sla_and_summaries", [
    ...notificationTemplateParts("attention", "Attention summary", "adminAttentionSummary"),
    emailTemplatePart("attention", "Attention summary", "adminAttentionSummary"),
    ...notificationTemplateParts("tomorrow-jobs", "Tomorrow's jobs", "tomorrowJobsSummary"),
    emailTemplatePart("tomorrow-jobs", "Tomorrow's jobs", "tomorrowJobsSummary"),
    ...notificationTemplateParts("tomorrow-laundry", "Tomorrow's laundry", "tomorrowLaundrySummary"),
    emailTemplatePart("tomorrow-laundry", "Tomorrow's laundry", "tomorrowLaundrySummary"),
    ...SLA_PARTS,
  ], "The job, laundry and stock lists inside the summaries are built from the day's records."),
  editable("office.new_profile", NEW_PROFILE_PARTS),
  REPORTS_GENERATED_WORDING,
  someParts("laundry.updates", [
    ...notificationTemplateParts("ready", "Laundry ready", "laundryReady"),
    emailTemplatePart("ready", "Laundry ready", "laundryReady"),
    ...notificationTemplateParts("skip-requested", "Skip requested", "laundrySkipRequested"),
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
  someParts("stock.alerts", [...notificationTemplateParts("office", "Office", "criticalInventoryTomorrow"), emailTemplatePart("office", "Office", "criticalInventoryTomorrow")], "Low-stock inbox rows are composed with the item list in lib/inventory/stock.ts, lib/ops/stock-alerts.ts and the scan-task route; not yet moved."),
  SUBMISSION_LOW_STOCK_WORDING,
  URGENT_NEED_WORDING,
  someParts("stock.shopping_and_orders", [
    ...notificationTemplateParts("run-submitted", "Shopping run submitted", "shoppingRunSubmitted"),
    emailTemplatePart("run-submitted", "Shopping run submitted", "shoppingRunSubmitted"),
    emailTemplatePart("reimbursement", "Reimbursement to client", "shoppingReimbursementToClient"),
    ...notificationTemplateParts("stock-run-requested", "Stock run requested", "stockRunRequested"),
    emailTemplatePart("stock-run-requested", "Stock run requested", "stockRunRequested"),
    ...notificationTemplateParts("stock-run-submitted", "Stock run submitted", "stockRunSubmitted"),
    emailTemplatePart("stock-run-submitted", "Stock run submitted", "stockRunSubmitted"),
  ], "Purchase-order and inbox notices are composed in lib/inventory/notifications.ts; not yet moved."),
  MAINTENANCE_WORDING,
  ICAL_ALERTS_WORDING,
  someParts("office.lost_found_report", [emailTemplatePart("office", "Office", "lostFoundAlert")], "The inbox row is composed in the cleaner lost-and-found route; not yet moved."),
];
