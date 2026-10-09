/** Operations access is an additional restriction, never a replacement for role/record guards. */
export const OPS_FEATURES = [
  {
    key: "files",
    label: "Files & media",
    group: "Operations",
    description:
      "Shared upload and preview tools. Access to job or property media also requires that workspace.",
  },
  {
    key: "dashboard",
    label: "Dashboard & activity",
    group: "Overview",
    description: "Command centre, activity and operational summaries.",
  },
  {
    key: "jobs",
    label: "Jobs & assignments",
    group: "Operations",
    description:
      "Job lists, details, scheduling, assignments and job billing views.",
  },
  {
    key: "calendar",
    label: "Calendar",
    group: "Operations",
    description: "Scheduling calendar and recurring jobs.",
  },
  {
    key: "approvals",
    label: "Approvals",
    group: "Operations",
    description: "Booking, client and job approval queues.",
  },
  {
    key: "cases",
    label: "Cases & issues",
    group: "Operations",
    description: "Cases, damage, disputes and issue follow-up.",
  },
  {
    key: "quality",
    label: "Quality & accountability",
    group: "Operations",
    description: "QA reviews, inspection queues and quality records.",
  },
  {
    key: "laundry",
    label: "Laundry",
    group: "Operations",
    description: "Laundry runs, planning, tracking, suppliers and reports.",
  },
  {
    key: "inventory",
    label: "Inventory & stock",
    group: "Operations",
    description: "Stock, purchasing, shopping runs and supplier requests.",
  },
  {
    key: "maintenance",
    label: "Maintenance",
    group: "Operations",
    description: "Maintenance tickets and coordination.",
  },
  {
    key: "lost-found",
    label: "Lost & found",
    group: "Operations",
    description: "Lost-property records and follow-up.",
  },
  {
    key: "properties",
    label: "Properties",
    group: "People & properties",
    description:
      "Property records, rate cards, care planning and integrations.",
  },
  {
    key: "clients",
    label: "Clients",
    group: "People & properties",
    description: "Client records, contacts and approvals.",
  },
  {
    key: "accounts",
    label: "Staff accounts",
    group: "People & properties",
    description:
      "Existing staff-account administration; security and role changes remain admin-only.",
  },
  {
    key: "workforce",
    label: "Workforce",
    group: "People & properties",
    description: "Cleaner roster, workforce, compliance and coaching.",
  },
  {
    key: "hiring",
    label: "Hiring",
    group: "People & properties",
    description: "Positions, applications and hiring pipeline.",
  },
  {
    key: "onboarding",
    label: "Property onboarding",
    group: "People & properties",
    description: "Surveys and property intake workflows.",
  },
  {
    key: "forms",
    label: "Forms & checklists",
    group: "Operations",
    description: "Forms, checklist library, submissions and template history.",
  },
  {
    key: "reports",
    label: "Reports",
    group: "Operations",
    description: "Job reports, themes, exports and sharing.",
  },
  {
    key: "quotes",
    label: "Quotes & leads",
    group: "Money",
    description: "Quotes, leads, proposals and sales pipeline.",
  },
  {
    key: "finance",
    label: "Finance & invoicing",
    group: "Money",
    description:
      "Finance workspace, invoices and subscriptions; job-level billing follows Jobs access.",
  },
  {
    key: "payroll",
    label: "Payroll & pay reviews",
    group: "Money",
    description:
      "Payroll, cleaner invoices, pay/time adjustments and pay runs.",
  },
  {
    key: "pricing",
    label: "Pricing & holiday rates",
    group: "Money",
    description:
      "Pricing, price book and holiday-rate tools; existing admin approvals remain required.",
  },
  {
    key: "communications",
    label: "Messages & notifications",
    group: "Communications",
    description:
      "Message centre, templates, delivery profiles and outbound notifications.",
  },
  {
    key: "marketing",
    label: "Marketing",
    group: "Communications",
    description: "Campaigns, growth and email marketing.",
  },
  {
    key: "website",
    label: "Website & blog",
    group: "Communications",
    description: "Website content, public widgets and blog posts.",
  },
  {
    key: "settings",
    label: "General settings",
    group: "Configuration",
    description:
      "Settings overview, company details, appearance and bank details.",
  },
  {
    key: "property-form",
    label: "Property form settings",
    group: "Configuration",
    description: "Property intake fields and required-field configuration.",
  },
  {
    key: "laundry-settings",
    label: "Laundry settings",
    group: "Configuration",
    description: "Laundry operating defaults and location lists.",
  },
  {
    key: "notification-settings",
    label: "Notification settings",
    group: "Configuration",
    description:
      "Notification schedules, audience channels and finance notifications.",
  },
  {
    key: "quality-settings",
    label: "Quality settings",
    group: "Configuration",
    description: "Operational safeguards and accountability configuration.",
  },
  {
    key: "integrations",
    label: "Integrations & calendar sync",
    group: "Configuration",
    description:
      "Connection diagnostics and sync operations; secret changes remain admin-only.",
  },
  {
    key: "ai",
    label: "AI tools",
    group: "Configuration",
    description:
      "AI proposals and existing diagnostics; credentials remain admin-only.",
  },
  {
    key: "system",
    label: "System & diagnostics",
    group: "Configuration",
    description:
      "Operational diagnostics, branches, automation and system tools.",
  },
] as const;
export type OpsFeature = (typeof OPS_FEATURES)[number]["key"];
export type OpsLevel = "off" | "read" | "manage";
export type OpsLevels = Record<OpsFeature, OpsLevel>;
export const OPS_FEATURE_KEYS = OPS_FEATURES.map((feature) => feature.key);
export const OPS_LEVEL_LABELS: Record<OpsLevel, string> = {
  off: "Off",
  read: "View only",
  manage: "Manage available actions",
};
export function allOpsLevels(level: OpsLevel): OpsLevels {
  return Object.fromEntries(
    OPS_FEATURE_KEYS.map((key) => [key, level]),
  ) as OpsLevels;
}
export const OPS_BUILTIN_PRESETS = [
  {
    id: "existing",
    name: "Existing ops access",
    description:
      "Keep the current role's access. Admin-only actions stay protected.",
    levels: allOpsLevels("manage"),
  },
  {
    id: "observer",
    name: "Observer",
    description: "View existing operational information without changing it.",
    levels: allOpsLevels("read"),
  },
  {
    id: "coordinator",
    name: "Coordinator",
    description:
      "Manage daily jobs, calendar, laundry, cases and messages; view other available areas.",
    levels: {
      ...allOpsLevels("read"),
      jobs: "manage",
      calendar: "manage",
      laundry: "manage",
      cases: "manage",
      maintenance: "manage",
      communications: "manage",
    } as OpsLevels,
  },
  {
    id: "restricted",
    name: "No feature access",
    description:
      "Start with every feature off and enable only what this person needs.",
    levels: allOpsLevels("off"),
  },
] as const;

const ADMIN_SECTIONS: Record<string, OpsFeature | "owner"> = {
  "": "dashboard",
  activity: "dashboard",
  "nav-attention": "dashboard",
  "live-locations": "dashboard",
  dispatch: "jobs",
  jobs: "jobs",
  "job-tasks": "jobs",
  "job-templates": "jobs",
  "job-continuations": "approvals",
  "job-early-checkouts": "approvals",
  "jobs-team-default": "jobs",
  calendar: "calendar",
  "recurring-jobs": "calendar",
  approvals: "approvals",
  "all-approvals": "approvals",
  "booking-requests": "approvals",
  "client-approvals": "approvals",
  cases: "cases",
  issues: "cases",
  damage: "cases",
  quality: "quality",
  qa: "quality",
  "qa-templates": "quality",
  accountability: "quality",
  laundry: "laundry",
  inventory: "inventory",
  "stock-runs": "inventory",
  "shopping-runs": "inventory",
  suppliers: "inventory",
  maintenance: "maintenance",
  "lost-found": "lost-found",
  properties: "properties",
  "property-client-rates": "properties",
  "deep-clean-planning": "properties",
  "deep-clean-proposals": "properties",
  clients: "clients",
  "va-teams": "clients",
  "va-invites": "clients",
  accounts: "accounts",
  users: "accounts",
  cleaners: "workforce",
  workforce: "workforce",
  hiring: "hiring",
  onboarding: "onboarding",
  forms: "forms",
  "form-templates": "forms",
  "form-submissions": "forms",
  "checklist-coverage": "forms",
  "checklist-library": "forms",
  checklists: "forms",
  reports: "reports",
  "report-themes": "reports",
  quotes: "quotes",
  leads: "quotes",
  finance: "finance",
  invoices: "finance",
  subscriptions: "finance",
  "turnover-profit": "finance",
  "payment-gateways": "finance",
  payroll: "payroll",
  "cleaner-invoices": "payroll",
  "pay-adjustments": "payroll",
  "time-adjustments": "payroll",
  pricebook: "pricing",
  pricing: "pricing",
  "holiday-rates": "pricing",
  "pay-rates": "pricing",
  notifications: "communications",
  messages: "communications",
  chat: "communications",
  templates: "communications",
  "message-templates": "communications",
  "delivery-profiles": "communications",
  "client-delivery-profiles": "communications",
  marketing: "marketing",
  campaigns: "marketing",
  "email-campaigns": "marketing",
  growth: "marketing",
  website: "website",
  "blog-posts": "website",
  settings: "settings",
  integrations: "integrations",
  ai: "ai",
  diagnostics: "system",
  system: "system",
  ops: "system",
  phase3: "system",
  phase4: "system",
  security: "owner",
  "test-as": "owner",
  impersonate: "owner",
  "ops-permissions": "owner",
  "media-overrides": "owner",
};
const SETTINGS_TABS: Record<string, OpsFeature | "owner"> = {
  overview: "settings",
  company: "settings",
  look: "settings",
  bank: "settings",
  editor: "settings",
  display: "settings",
  rates: "pricing",
  "pricing-variables": "pricing",
  "holiday-rates": "pricing",
  "pay-rates": "pricing",
  pricebook: "pricing",
  "payment-gateways": "finance",
  xero: "finance",
  laundry: "laundry-settings",
  "property-form": "property-form",
  safeguards: "quality-settings",
  accountability: "quality-settings",
  notifications: "notification-settings",
  "message-channels": "notification-settings",
  "finance-notifications": "notification-settings",
  "notification-tools": "communications",
  "public-widgets": "website",
  integrations: "integrations",
  "ical-sync": "integrations",
  ollama: "ai",
  roles: "owner",
  "profile-permissions": "owner",
  portals: "owner",
  audit: "owner",
  restore: "owner",
  "invoice-cadence": "finance",
  "invoice-numbering": "finance",
};

export type OpsRequestFeature = OpsFeature | "owner" | "unmapped" | null;
/** Stable route ownership; special cases precede their parent section. */
export function opsRequestFeature(input: string): OpsRequestFeature {
  const url = new URL(input, "http://internal");
  const path = url.pathname
    .replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "")
    .replace(/^\/v2(?=\/)/, "");
  if (
    /^\/(?:api\/)?admin\/users\/[^/]+\/(?:roles|password|reset-password|sessions|two-factor)(?:\/|$)/.test(
      path,
    )
  )
    return "owner";
  if (
    /^\/api\/admin\/(?:integrations\/credentials|system\/(?:backup|restore|reset|cleanup|purge)|settings\/audit)(?:\/|$)/.test(
      path,
    )
  )
    return "owner";
  if (
    /^\/(?:api\/)?admin\/phase[34]\/(?:supplier-orders|stock-forecast|shopping-runs)/.test(
      path,
    )
  )
    return "inventory";
  if (/^\/(?:api\/)?admin\/phase4\/payruns/.test(path)) return "payroll";
  if (/^\/(?:api\/)?admin\/phase4\/disputes/.test(path)) return "cases";
  if (/^\/(?:api\/)?admin\/phase4\/reschedule/.test(path)) return "calendar";
  if (/^\/(?:api\/)?admin\/phase4\/template-versions/.test(path))
    return "forms";
  if (/^\/(?:api\/)?admin\/phase4\/notification-rules/.test(path))
    return "notification-settings";
  if (/^\/(?:api\/)?admin\/settings(?:\/|$)/.test(path)) {
    const section =
      path.split("/settings/")[1]?.split("/")[0] ??
      (path.startsWith("/api/") ? null : url.searchParams.get("tab")) ??
      "overview";
    return SETTINGS_TABS[section] ?? "unmapped";
  }
  if (/^\/(?:api\/)?admin(?:\/|$)/.test(path)) {
    const section =
      path
        .replace(/^\/(?:api\/)?admin(?:\/|$)/, "")
        .split("/")
        .filter(Boolean)[0] ?? "";
    if (["profile", "access-denied"].includes(section)) return null;
    return ADMIN_SECTIONS[section] ?? "unmapped";
  }
  if (/^\/api\/me\/jobs-views(?:\/|$)/.test(path)) return "jobs";
  // Alternate worker-facing endpoints also accept operations managers.
  if (/^\/api\/cleaner\/(?:inventory|stock-runs)(?:\/|$)/.test(path))
    return "inventory";
  if (
    /^\/api\/cleaner\/(?:jobs|job-early-checkouts|today-route|briefing|rework-offers)(?:\/|$)/.test(
      path,
    )
  )
    return "jobs";
  if (/^\/api\/cleaner\/(?:pay-adjustments|invoice)(?:\/|$)/.test(path))
    return "payroll";
  if (
    /^\/api\/cleaner\/(?:coaching|availability)(?:\/|$)/.test(path) ||
    /^\/api\/me\/workforce(?:\/|$)/.test(path)
  )
    return "workforce";
  if (/^\/api\/cleaner\/lost-found(?:\/|$)/.test(path)) return "lost-found";
  if (/^\/api\/cleaner\/property-access(?:\/|$)/.test(path))
    return "properties";
  if (/^\/api\/cleaner\/qa-feedback(?:\/|$)/.test(path)) return "quality";
  if (/^\/api\/uploads(?:\/|$)/.test(path)) {
    const key = url.searchParams.get("key") ?? "";
    if (/^(?:jobs|forms)\//.test(key) || url.searchParams.has("jobId"))
      return "jobs";
    if (/^properties\//.test(key)) return "properties";
    return "files";
  }
  const shared: Array<[RegExp, OpsFeature]> = [
    [/^\/(?:api\/)?(?:chat|notifications)(?:\/|$)/, "communications"],
    [/^\/(?:api\/)?lost-found(?:\/|$)/, "lost-found"],
    [/^\/(?:api\/)?workforce(?:\/|$)/, "workforce"],
    [/^\/(?:api\/)?(?:integrations|xero)(?:\/|$)/, "integrations"],
    [/^\/api\/(?:scan-tasks|nfc)(?:\/|$)/, "inventory"],
    [/^\/(?:api\/)?jobs(?:\/|$)/, "jobs"],
    [/^\/(?:api\/)?(?:laundry|linen-bags)(?:\/|$)/, "laundry"],
    [
      /^\/(?:api\/)?(?:inventory|urgent-stock|shopping|stock)(?:\/|$)/,
      "inventory",
    ],
    [/^\/(?:api\/)?(?:properties|property-care)(?:\/|$)/, "properties"],
    [/^\/(?:api\/)?clients(?:\/|$)/, "clients"],
    [/^\/(?:api\/)?(?:qa|quality)(?:\/|$)/, "quality"],
    [/^\/(?:api\/)?maintenance(?:\/|$)/, "maintenance"],
    [/^\/(?:api\/)?(?:quotes|leads)(?:\/|$)/, "quotes"],
    [/^\/(?:api\/)?(?:reports|report)(?:\/|$)/, "reports"],
    [/^\/(?:api\/)?(?:finance|invoices|turnover-profit)(?:\/|$)/, "finance"],
    [/^\/(?:api\/)?(?:forms|form-templates|checklists)(?:\/|$)/, "forms"],
    [/^\/(?:api\/)?(?:cases|issues|damage)(?:\/|$)/, "cases"],
  ];
  return shared.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

export function opsLevelAllows(level: OpsLevel, method: string): boolean {
  return (
    level === "manage" ||
    (level === "read" &&
      ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()))
  );
}
export function canUseOpsPath(
  levels: OpsLevels,
  path: string,
  method = "GET",
): boolean {
  const feature = opsRequestFeature(path);
  const pathname = new URL(path, "http://internal").pathname.replace(
    /^\/_accounts\/[a-f0-9]{32}(?=\/)/,
    "",
  );
  if (
    pathname.startsWith("/api/uploads/") &&
    !opsLevelAllows(levels.files, method)
  )
    return false;
  return (
    feature === null ||
    (feature !== "owner" &&
      feature !== "unmapped" &&
      opsLevelAllows(levels[feature], method))
  );
}

/** Keep a route into allowed settings when its general overview is disabled. */
export function opsNavigationHref(
  levels: OpsLevels | null,
  href: string,
): string | null {
  if (!levels || canUseOpsPath(levels, href)) return href;
  if (/^\/(?:v2\/)?admin\/settings$/.test(href)) {
    const tab = Object.keys(SETTINGS_TABS).find((key) =>
      canUseOpsPath(levels, `${href}?tab=${key}`),
    );
    if (tab) return `${href}?tab=${tab}`;
  }
  return null;
}
