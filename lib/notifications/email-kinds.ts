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
  // Changes an admin makes to a job AFTER a cleaner has been told about it.
  // These three used to happen in silence: the cleaner arrived holding
  // yesterday's instructions (2026-08).
  { key: "timing_rule_changed", label: "Timing rule changes", description: "Early check-in / late check-out rules changed on an assigned job." },
  { key: "job_task_added", label: "Extra tasks added", description: "An admin or approved client request added tasks to an assigned job." },
  { key: "special_note_changed", label: "Job note changes", description: "The job's special note was edited or cleared." },
  // Finance events (lib/notifications/events.ts) previously carried no kind at
  // all, so the per-kind switches could not target them. Five kinds cover the
  // 34 events; the rest map onto existing kinds (see FINANCE_EVENT_EMAIL_KIND
  // in lib/notifications/engine.ts).
  { key: "payment_receipt", label: "Payment receipts", description: "Client-facing receipts for payments and refunds." },
  { key: "payment_reminder", label: "Payment reminders", description: "Overdue invoices, payment links and failed payments." },
  { key: "payout_notice", label: "Payout notices", description: "A cleaner's own payout sent or failed." },
  { key: "payroll_update", label: "Payroll updates", description: "Payroll run lifecycle and ABA file notices." },
  { key: "integration_sync", label: "Integration sync notices", description: "Xero connection and sync events." },
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
  /**
   * Per-audience overrides of a type: `audienceKinds[audience][kind] === false`
   * silences that kind for that group only.
   *
   * The type switch above is all-or-nothing, so the only way to stop emailing
   * cleaners about (say) inventory was to stop emailing everyone about it —
   * including the ops manager who needs it. A MISSING entry means allowed, so
   * the map starts empty and changes nothing until an admin unticks a cell.
   */
  audienceKinds?: Record<string, Record<string, boolean>>;
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
  // Free-form on purpose: audiences and kinds are both open sets, and dropping
  // an unrecognised pair on load would silently re-enable a kind an admin had
  // switched off (e.g. after a rename, or while a deploy is mid-rollout).
  const audienceKindsIn =
    row.audienceKinds && typeof row.audienceKinds === "object"
      ? (row.audienceKinds as Record<string, unknown>)
      : {};
  const audienceKinds: Record<string, Record<string, boolean>> = {};
  for (const [audience, value] of Object.entries(audienceKindsIn)) {
    if (!value || typeof value !== "object") continue;
    const bucket: Record<string, boolean> = {};
    for (const [kind, enabled] of Object.entries(value as Record<string, unknown>)) {
      if (typeof enabled === "boolean") bucket[kind] = enabled;
    }
    if (Object.keys(bucket).length > 0) audienceKinds[audience] = bucket;
  }

  return {
    masterEnabled: typeof row.masterEnabled === "boolean" ? row.masterEnabled : fallback.masterEnabled,
    types,
    audienceKinds,
  };
}

/**
 * True when this kind is allowed to reach this audience.
 *
 * Only an explicit `false` blocks. Anything else — no map, no audience entry,
 * no kind entry — means allowed, so the matrix can only ever take email away
 * from a group an admin chose, never withhold it by omission.
 */
export function isAudienceKindAllowed(
  settings: EmailAutomationSettings | undefined,
  audience: string | null | undefined,
  kind: string | null | undefined
): boolean {
  if (!settings || !audience || !kind) return true;
  return settings.audienceKinds?.[audience]?.[kind] !== false;
}

/** True when an auto email of this kind is allowed to send right now. */
export function isAutoEmailAllowed(settings: EmailAutomationSettings | undefined, kind: EmailAutoKind): boolean {
  if (!settings) return true;
  if (!settings.masterEnabled) return false;
  return settings.types?.[kind] !== false;
}
