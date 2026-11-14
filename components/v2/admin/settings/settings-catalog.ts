/** Navigation metadata only. Never put settings values or credentials here. */
export const SETTINGS_GROUPS = [
  {
    key: "brand",
    label: "Company & brand",
    shortLabel: "Brand",
    description: "Company details, appearance and public website.",
  },
  {
    key: "notifications",
    label: "Notifications",
    shortLabel: "Notifications",
    description: "Schedules, audiences and message delivery tools.",
  },
  {
    key: "money",
    label: "Money",
    shortLabel: "Money",
    description: "Banking, cleaner pay, holiday rates and billing connections.",
  },
  {
    key: "quality",
    label: "Cleaners & quality",
    shortLabel: "Quality",
    description: "Job safeguards, submission checks and accountability.",
  },
  {
    key: "operations",
    label: "Operations",
    shortLabel: "Operations",
    description: "Laundry locations, property forms and calendar connections.",
  },
  {
    key: "access",
    label: "Access & permissions",
    shortLabel: "Access",
    description: "Portal visibility, profiles and staff permissions.",
  },
  {
    key: "ai",
    label: "Automation and AI",
    shortLabel: "AI",
    description: "Where AI runs, what it does, photo checks, what it costs and what leaves this server.",
  },
  {
    key: "system",
    label: "System",
    shortLabel: "System",
    description: "The settings audit trail, and tutorials and What's new.",
  },
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]["key"];
export type SettingsDestination = {
  key: string;
  label: string;
  description: string;
  group: SettingsGroup;
  adminOnly: boolean;
  /** A destination that lives on its own page instead of a settings tab. */
  href?: string;
};

export const SETTINGS_DESTINATIONS = [
  {
    key: "company",
    label: "Company & brand",
    description:
      "Company name, logos, timezone, contact details and quote defaults.",
    group: "brand",
    adminOnly: false,
  },
  {
    key: "look",
    label: "Default look",
    description: "Choose the default portal appearance.",
    group: "brand",
    adminOnly: true,
  },
  {
    // The look every email uses (email design system, 2026-11): logo, brand
    // colour (contrast-checked), button shape, sender, reply-to, footer line.
    // Reads: ADMIN and ops managers with the notifications pack; changes:
    // ADMIN only, publishing with their own PIN.
    key: "email-look",
    label: "Email look",
    description: "Logo, brand colour, button shape, sender name, reply-to and the footer line on every email.",
    group: "brand",
    adminOnly: false,
    href: "/v2/admin/notifications/email-look",
  },
  {
    key: "public-widgets",
    label: "Public site widgets",
    description: "Show or hide widgets on the public website.",
    group: "brand",
    adminOnly: true,
  },
  {
    // The one notifications area: every notification type, its switches, the
    // delivery log, transport health and organisation preferences. The tabs
    // below keep working at their old URLs.
    key: "notifications-area",
    label: "All notifications",
    description:
      "Every notification type, who receives it, its switches, delivery log and health.",
    group: "notifications",
    adminOnly: false,
    href: "/v2/admin/notifications",
  },
  {
    // Caps per person, automatic pauses when something loops, the emergency
    // stop and what was not sent (own page; reads: ADMIN and ops managers with
    // the notifications pack; changes: ADMIN with their PIN).
    key: "sending-safeguards",
    label: "Sending safeguards",
    description:
      "Limits on emails, SMS and push per person, automatic pauses, the emergency stop and what was not sent.",
    group: "notifications",
    adminOnly: false,
    href: "/v2/admin/notifications/safeguards",
  },
  {
    key: "notifications",
    label: "Scheduled notifications",
    description: "Reminder schedules and default delivery channels.",
    group: "notifications",
    adminOnly: true,
  },
  {
    key: "message-channels",
    label: "Message channels",
    description: "Control email, SMS and push for each audience.",
    group: "notifications",
    adminOnly: true,
  },
  {
    key: "finance-notifications",
    label: "Finance notifications",
    description: "Invoice and payment notification preferences.",
    group: "notifications",
    adminOnly: true,
  },
  {
    key: "insights-email",
    label: "Monthly Insights email",
    description: "Last month's business summary by email: recipients, day and hour, sections.",
    group: "notifications",
    adminOnly: true,
  },
  {
    key: "notification-tools",
    label: "Notification tools",
    description: "Check providers and test message delivery.",
    group: "notifications",
    adminOnly: false,
  },
  {
    key: "bank",
    label: "Bank & payment",
    description: "Bank account, ABN, invoice numbering and payment terms.",
    group: "money",
    adminOnly: false,
  },
  {
    key: "rates",
    label: "Cleaner rates",
    description: "Hourly pay rates by cleaner and job type.",
    group: "money",
    adminOnly: true,
  },
  {
    key: "holiday-rates",
    label: "Public holiday rates",
    description:
      "Holiday calendar, rate multipliers and reviewed job adjustments.",
    group: "money",
    adminOnly: true,
  },
  {
    key: "pricing-variables",
    label: "Pricing variables",
    description: "Reusable variables for pricing calculations.",
    group: "money",
    adminOnly: true,
  },
  {
    key: "payment-gateways",
    label: "Payment gateways",
    description: "Stripe, Square and PayPal payment connections.",
    group: "money",
    adminOnly: true,
  },
  {
    key: "xero",
    label: "Xero",
    description: "Accounting connection and invoice synchronization.",
    group: "money",
    adminOnly: true,
  },
  {
    key: "safeguards",
    label: "Operational safeguards",
    description:
      "Job start rules, auto clock-out, assignment and QA automation.",
    group: "quality",
    adminOnly: true,
  },
  {
    key: "accountability",
    label: "Accountability",
    description: "Quality scoring, final check-up and photo exemptions.",
    group: "quality",
    adminOnly: true,
  },
  {
    key: "laundry",
    label: "Laundry & locations",
    description:
      "Laundry visibility, collection rules and bag drop-off locations.",
    group: "operations",
    adminOnly: true,
  },
  {
    // Owner decision 2026-11-14: the laundry and job auto-scheduling rules,
    // visible and locked, with versions, backups and restore.
    key: "scheduling-rules",
    label: "Scheduling rules",
    description: "How laundry runs and jobs are planned automatically. Locked, versioned, with backups and restore.",
    group: "operations",
    adminOnly: false,
    href: "/v2/admin/settings/scheduling-rules",
  },
  {
    key: "lost-found",
    label: "Lost and found",
    description: "How long found items are held before they are flagged for a decision.",
    group: "operations",
    adminOnly: true,
  },
  {
    key: "property-form",
    label: "Property form",
    description:
      "Required fields, conditional visibility and custom property fields.",
    group: "operations",
    adminOnly: false,
  },
  {
    key: "ical-sync",
    label: "iCal sync",
    description: "Calendar feeds, reservation sync and recent runs.",
    group: "operations",
    adminOnly: true,
  },
  {
    key: "integrations",
    label: "Integrations",
    description: "API connections, credentials and service diagnostics.",
    group: "operations",
    adminOnly: true,
  },
  {
    key: "portals",
    label: "Portal visibility",
    description: "Choose which features clients and cleaners can see.",
    group: "access",
    adminOnly: true,
  },
  {
    key: "required-documents",
    label: "Required documents",
    description: "Which staff documents each role must have on file. Nothing is required until you choose.",
    group: "access",
    adminOnly: false,
  },
  {
    key: "profile-permissions",
    label: "Profile permissions",
    description: "Who can edit names, phone numbers and email addresses.",
    group: "access",
    adminOnly: true,
  },
  {
    // Kept as "roles" so old links and searches keep working; it opens the
    // Access and permissions page (2026-11 redesign).
    key: "roles",
    label: "Access and permissions",
    description: "Who can do what in the office: levels per area, capabilities, presets, client assistants and history.",
    group: "access",
    adminOnly: true,
    href: "/v2/admin/settings/access",
  },
  {
    key: "agents",
    label: "Agents (Hermes, Claude)",
    description: "Connect AI agents that read your operations within the access you choose and may ask for changes a person approves; tokens, write packs, revoke, recent calls.",
    group: "access",
    adminOnly: true,
    href: "/v2/admin/settings/agents",
  },
  {
    // One AI page (2026-11-15 rebuild). Operations managers read it with the
    // "AI tools" pack; only administrators change anything (server-enforced).
    key: "ai",
    label: "AI",
    description: "Where AI runs, what each feature does, photo checks, usage and cost, privacy. Keys, tests and limits.",
    group: "ai",
    adminOnly: false,
    href: "/v2/admin/ai",
  },
  {
    // The old "Photo checks and memory" page is now Section 3 of the AI page.
    key: "ai-workflows",
    label: "Photo checks and memory",
    description: "Confidence bands, deduction points, opted-out properties, agreement with inspectors and the property photo memory.",
    group: "ai",
    adminOnly: false,
    href: "/v2/admin/ai#photo-checks",
  },
  {
    // The old Ollama tab opens the Local Ollama setup on the AI page.
    key: "ollama",
    label: "Ollama",
    description: "Local AI models, connection settings and diagnostics.",
    group: "ai",
    adminOnly: true,
    href: "/v2/admin/ai?section=ollama",
  },
  {
    // Tutorials (2026-11-16, board "Tutorials settings"). Operations managers
    // view with the Settings pack; only administrators edit (server-enforced).
    key: "tutorials",
    label: "Tutorials and What's new",
    description: "Welcome screens, page tours, practice walkthroughs and What's new for every role: wording, order, switches, people and release notes.",
    group: "system",
    adminOnly: false,
    href: "/v2/admin/settings/tutorials",
  },
  {
    key: "audit",
    label: "Audit log",
    description: "Review recorded settings changes and their authors.",
    group: "system",
    adminOnly: true,
  },
] as const satisfies readonly SettingsDestination[];

/**
 * `grantedKeys`: admin-only destinations opened to this person by an
 * administrator capability (the server re-checks on the destination).
 */
export function availableSettings(isAdmin: boolean, grantedKeys: readonly string[] = []) {
  return SETTINGS_DESTINATIONS.filter(
    (section) => isAdmin || !section.adminOnly || grantedKeys.includes(section.key),
  );
}

export function settingsHref(key: string, jobId?: string) {
  const destination: SettingsDestination | undefined = SETTINGS_DESTINATIONS.find((section) => section.key === key);
  if (destination?.href) return destination.href;
  const query = new URLSearchParams({ tab: key });
  if (key === "holiday-rates" && jobId) query.set("jobId", jobId);
  return `/v2/admin/settings?${query}`;
}
