/**
 * Registry of AUTOMATIC email types the system sends on its own (scheduled jobs
 * or event triggers — not admin-clicked "send" actions). Each is individually
 * switchable, and there's a master switch over all of them. Manual/transactional
 * emails (password reset, OTP, 2FA, invitations, admin-clicked invoice/quote/
 * report sends) carry no `kind` and are never gated here.
 *
 * No imports here on purpose — this is shared by lib/settings.ts and the email
 * chokepoint, so it must stay dependency-free to avoid import cycles.
 */
export const EMAIL_AUTO_KINDS = [
  { key: "job_reminder", label: "Job reminders", description: "24-hour and 2-hour reminders to cleaners and clients." },
  { key: "tomorrow_prep", label: "Tomorrow prep dispatch", description: "Nightly summary of tomorrow's jobs." },
  { key: "daily_briefing", label: "Daily briefing", description: "Morning operations briefing email." },
  { key: "stock_alert", label: "Critical stock alerts", description: "Low / critical inventory alerts." },
  { key: "admin_summary", label: "Admin attention summary", description: "Daily digest of items needing attention." },
  { key: "auto_invoice", label: "Automatic invoices", description: "Auto-generated client invoices on completion." },
  { key: "follow_up", label: "Follow-up sequences", description: "Automated lead / client follow-up emails." },
  { key: "client_job_update", label: "Client job updates", description: "En route / started / completed emails to clients." },
  { key: "client_automation", label: "Client post-job automation", description: "Post-job report & review automation emails." },
  { key: "ical_alert", label: "iCal sync alerts", description: "Calendar sync change notifications to admins." },
  { key: "profile_welcome", label: "New profile welcome", description: "Welcome email when an account is created." },
  { key: "inventory_update", label: "Inventory & shopping updates", description: "Shopping run / restock notifications." },
  { key: "case_alert", label: "Case & damage alerts", description: "Damage report / case update emails." },
  { key: "time_adjustment", label: "Time adjustment requests", description: "Clock-adjustment approval request emails." },
  { key: "lead_alert", label: "New lead alerts", description: "New website lead / enquiry alerts to admins." },
  { key: "pay_adjustment", label: "Pay adjustment notices", description: "Cleaner pay-adjustment emails." },
  { key: "job_assignment", label: "Job assignment alerts", description: "Emails to cleaners when assigned to a job." },
  { key: "admin_alert", label: "General admin alerts", description: "Miscellaneous system alerts to admins / ops." },
  { key: "report_delivery", label: "Report & invoice delivery", description: "Auto-delivery of reports and invoices to clients." },
  { key: "workforce_update", label: "Workforce & learning", description: "Training assignments and workforce emails." },
] as const;

export type EmailAutoKind = (typeof EMAIL_AUTO_KINDS)[number]["key"];

export const EMAIL_AUTO_KIND_KEYS: EmailAutoKind[] = EMAIL_AUTO_KINDS.map((k) => k.key);

/** All types on by default; new types added later backfill to on. */
export function defaultEmailAutomationTypes(): Record<EmailAutoKind, boolean> {
  return Object.fromEntries(EMAIL_AUTO_KIND_KEYS.map((k) => [k, true])) as Record<EmailAutoKind, boolean>;
}

export interface EmailAutomationSettings {
  /** Master kill-switch for every automatic email. */
  masterEnabled: boolean;
  /** Per-type switches keyed by EmailAutoKind. */
  types: Record<string, boolean>;
}

export const DEFAULT_EMAIL_AUTOMATION: EmailAutomationSettings = {
  masterEnabled: true,
  types: defaultEmailAutomationTypes(),
};

export function sanitizeEmailAutomation(
  input: unknown,
  fallback: EmailAutomationSettings = DEFAULT_EMAIL_AUTOMATION
): EmailAutomationSettings {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const typesIn = row.types && typeof row.types === "object" ? (row.types as Record<string, unknown>) : {};
  // Start from defaults (all on) so newly-added kinds are enabled, then apply
  // any explicit booleans the admin saved for known keys.
  const types = defaultEmailAutomationTypes();
  for (const key of EMAIL_AUTO_KIND_KEYS) {
    if (typeof typesIn[key] === "boolean") types[key] = typesIn[key] as boolean;
  }
  return {
    masterEnabled: typeof row.masterEnabled === "boolean" ? row.masterEnabled : fallback.masterEnabled,
    types,
  };
}

/** True when an auto email of this kind is allowed to send right now. */
export function isAutoEmailAllowed(settings: EmailAutomationSettings | undefined, kind: EmailAutoKind): boolean {
  if (!settings) return true;
  if (!settings.masterEnabled) return false;
  return settings.types?.[kind] !== false;
}
