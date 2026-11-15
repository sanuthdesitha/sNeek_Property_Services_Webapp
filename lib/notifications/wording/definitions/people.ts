/** Wording definitions for client, account, money, workforce and marketing types (catalog-people.ts). */
import type { TypeWordingDefinition } from "../types";
import { composed, editable, elsewhere, emailTemplatePart, inCode, someParts } from "./build";
import { CLIENT_UPDATE_WORDING } from "./client-updates";
import { LEAD_ALERTS_WORDING } from "./office-alerts";
import { POST_JOB_WORDING } from "./post-job";
import { WORKFORCE_WORDING } from "./workforce";
import { CLIENT_DOCUMENT_PARTS } from "./client-documents";
import { CLIENT_APPROVAL_PARTS, INVITATION_PARTS } from "./client-approvals";

export const PEOPLE_WORDING: readonly TypeWordingDefinition[] = [
  CLIENT_UPDATE_WORDING,
  elsewhere("client.lifecycle_email", "Booked, reminder, rescheduled, completed, report, invoice, re-clean, cancelled and custom emails are Email designs (one per stage), edited under this type's details.", "/v2/admin/notifications?type=client.lifecycle_email&email=lifecycle.BOOKING_CONFIRMED"),
  POST_JOB_WORDING,
  editable("client.documents", CLIENT_DOCUMENT_PARTS, "The quote, checklist, add-on list, invoice PDF, payment link and payment receipt are generated documents; the quote email's default subject is the setting \"Quote email subject\"."),
  editable("client.approvals", CLIENT_APPROVAL_PARTS),
  composed("client.office_messages", "The office writes these messages in the composer; reusable message templates are in Forms.", "/v2/admin/forms?tab=messages&view=messages"),
  someParts("account.security", [
    emailTemplatePart("signup-code", "Sign-up code", "signupOtp", ["code"]),
    emailTemplatePart("reset", "Password reset", "resetPassword"),
  ], "Two-step verification codes and recovery emails are composed in the 2FA routes and are deliberately fixed (security wording)."),
  editable("account.invitations", INVITATION_PARTS, "A temporary password the template leaves out is still appended automatically (credential fail-safe)."),
  elsewhere("money.finance_events", "Each finance event's email is an Email design (\"Finance: …\", under this type's details); SMS and push wording stay in Preferences, Finance notification templates.", "/v2/admin/notifications?tab=preferences#finance-notifications"),
  WORKFORCE_WORDING,
  LEAD_ALERTS_WORDING,
  composed("marketing.campaigns", "Each campaign's email and SMS are written in the campaign editor (Growth).", "/v2/admin/growth"),
  inCode("system.provider_tests", "Provider and device diagnostics: their fixed wording is what identifies a test message, so it is not editable on purpose."),
];
