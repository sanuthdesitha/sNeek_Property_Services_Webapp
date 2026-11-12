/** Wording definitions for the office, laundry and stock types (catalog-office.ts). */
import type { TypeWordingDefinition } from "../types";
import { editable, emailTemplatePart, inCode, notificationTemplateParts, someParts, storePart } from "./build";
import { SUBMISSION_LOW_STOCK_WORDING, URGENT_NEED_WORDING } from "./stock";
import { ICAL_ALERTS_WORDING, REPORTS_GENERATED_WORDING } from "./office-alerts";
import { MAINTENANCE_WORDING } from "./maintenance";
import { CASE_FOLLOW_UP_PARTS, NEW_PROFILE_PARTS, SLA_PARTS } from "./office-summaries";
import { LAUNDRY_UPDATE_PARTS } from "./laundry-updates";
import { LOST_FOUND_PARTS, SHOPPING_PARTS, STOCK_ALERT_PARTS } from "./stock-shopping";
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
  editable("laundry.updates", LAUNDRY_UPDATE_PARTS),
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
  editable("stock.alerts", STOCK_ALERT_PARTS, "The item lines inside the alerts are built from the stock records."),
  SUBMISSION_LOW_STOCK_WORDING,
  URGENT_NEED_WORDING,
  editable("stock.shopping_and_orders", SHOPPING_PARTS, "Item tables, costs and receipt lists inside these emails are built from the purchase records; the attached PDFs are generated documents."),
  MAINTENANCE_WORDING,
  ICAL_ALERTS_WORDING,
  editable("office.lost_found_report", LOST_FOUND_PARTS),
];
