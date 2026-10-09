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
    key: "system",
    label: "System",
    shortLabel: "System",
    description: "AI connection diagnostics and the settings audit trail.",
  },
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]["key"];
export type SettingsDestination = {
  key: string;
  label: string;
  description: string;
  group: SettingsGroup;
  adminOnly: boolean;
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
    key: "public-widgets",
    label: "Public site widgets",
    description: "Show or hide widgets on the public website.",
    group: "brand",
    adminOnly: true,
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
    key: "profile-permissions",
    label: "Profile permissions",
    description: "Who can edit names, phone numbers and email addresses.",
    group: "access",
    adminOnly: true,
  },
  {
    key: "roles",
    label: "Roles & permissions",
    description: "Manage operations-manager permission packs and feature access.",
    group: "access",
    adminOnly: true,
  },
  {
    key: "ollama",
    label: "Ollama",
    description: "Local AI models, connection settings and diagnostics.",
    group: "system",
    adminOnly: true,
  },
  {
    key: "audit",
    label: "Audit log",
    description: "Review recorded settings changes and their authors.",
    group: "system",
    adminOnly: true,
  },
] as const satisfies readonly SettingsDestination[];

export function availableSettings(isAdmin: boolean) {
  return SETTINGS_DESTINATIONS.filter(
    (section) => isAdmin || !section.adminOnly,
  );
}

export function settingsHref(key: string, jobId?: string) {
  const query = new URLSearchParams({ tab: key });
  if (key === "holiday-rates" && jobId) query.set("jobId", jobId);
  return `/v2/admin/settings?${query}`;
}
