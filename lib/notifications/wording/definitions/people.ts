/** Wording definitions for client, account, money, workforce and marketing types (catalog-people.ts). */
import type { TypeWordingDefinition } from "../types";
import { composed, elsewhere, emailTemplatePart, inCode, someParts } from "./build";
import { CLIENT_UPDATE_WORDING } from "./client-updates";
import { LEAD_ALERTS_WORDING } from "./office-alerts";
import { POST_JOB_WORDING } from "./post-job";

export const PEOPLE_WORDING: readonly TypeWordingDefinition[] = [
  CLIENT_UPDATE_WORDING,
  elsewhere("client.lifecycle_email", "Booked, reminder, rescheduled and cancelled emails have their own template editor in Forms (Messages, Lifecycle).", "/v2/admin/forms?tab=messages&view=notifications"),
  POST_JOB_WORDING,
  someParts("client.documents", [
    emailTemplatePart("invoice", "Invoice issued", "clientInvoiceIssued"),
    emailTemplatePart("report", "Report shared", "cleaningReportShared"),
    emailTemplatePart("report-visibility", "Report visibility changed", "reportVisibilityChanged"),
    emailTemplatePart("quote", "Quote sent", "quoteSentToClient"),
  ], "Other document emails in lib/notifications/documents.ts are composed with the attachment details; not yet moved."),
  someParts("client.approvals", [emailTemplatePart("client", "Client", "quoteApprovalRequest")], "The inbox row and phone push of an approval request are composed in the client-approvals route; not yet moved."),
  composed("client.office_messages", "The office writes these messages in the composer; reusable message templates are in Forms.", "/v2/admin/forms?tab=messages&view=messages"),
  someParts("account.security", [
    emailTemplatePart("signup-code", "Sign-up code", "signupOtp", ["code"]),
    emailTemplatePart("reset", "Password reset", "resetPassword"),
  ], "Two-step verification codes and recovery emails are composed in the 2FA routes and are deliberately fixed (security wording)."),
  someParts("account.invitations", [
    emailTemplatePart("invite", "Invitation", "accountInvite"),
    emailTemplatePart("welcome", "Welcome", "welcomeAccount"),
  ], "A temporary password the template leaves out is still appended automatically (credential fail-safe)."),
  elsewhere("money.finance_events", "Invoice, payroll, payout and Xero event wording has its own template editor (Preferences, Finance notification templates).", "/v2/admin/notifications?tab=preferences#finance-notifications"),
  inCode("workforce.updates", "Chat, learning, document and hiring notices are composed in lib/workforce/service.ts and quiz.ts, one sentence per event; not yet split into named parts."),
  LEAD_ALERTS_WORDING,
  composed("marketing.campaigns", "Each campaign's email and SMS are written in the campaign editor (Growth).", "/v2/admin/growth"),
  inCode("system.provider_tests", "Provider and device diagnostics: their fixed wording is what identifies a test message, so it is not editable on purpose."),
];
