import type { CapabilityKey } from "./capabilities";
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
/**
 * The stored level of an area. "full" is Manage plus the area's sensitive
 * capabilities (still verified with the person's PIN); it routes exactly like
 * Manage, so middleware, navigation and path guards keep using `OpsLevels`.
 */
export type AccessLevel = OpsLevel | "full";
export type AccessLevels = Record<OpsFeature, AccessLevel>;
export const OPS_FEATURE_KEYS = OPS_FEATURES.map((feature) => feature.key);
export const OPS_LEVEL_LABELS: Record<OpsLevel, string> = {
  off: "Off",
  read: "View",
  manage: "Manage",
};
export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  ...OPS_LEVEL_LABELS,
  full: "Full",
};
export const ACCESS_LEVEL_ORDER: readonly AccessLevel[] = ["off", "read", "manage", "full"];
export function allOpsLevels(level: OpsLevel): OpsLevels {
  return Object.fromEntries(
    OPS_FEATURE_KEYS.map((key) => [key, level]),
  ) as OpsLevels;
}
function levelsWith(base: OpsLevel, changes: Partial<OpsLevels>): OpsLevels {
  return { ...allOpsLevels(base), ...changes };
}
/**
 * Built-in starting points. IDs are stored in assignments and never change;
 * names are display only. `audience` decides the list a person appears in:
 * an "assistant" preset makes an OPS_MANAGER login an office assistant (no
 * new role).
 */
export const OPS_BUILTIN_PRESETS = [
  {
    id: "existing",
    name: "Existing ops access",
    description:
      "Keep the current role's access. Admin-only actions stay protected.",
    levels: allOpsLevels("manage"),
    audience: "manager",
  },
  {
    id: "observer",
    name: "Read only",
    description: "View existing operational information without changing it.",
    levels: allOpsLevels("read"),
    audience: "manager",
  },
  {
    id: "coordinator",
    name: "Coordinator",
    description:
      "Manage daily jobs, calendar, laundry, cases and messages; view other available areas.",
    levels: levelsWith("read", {
      jobs: "manage",
      calendar: "manage",
      laundry: "manage",
      cases: "manage",
      maintenance: "manage",
      communications: "manage",
    }),
    audience: "manager",
  },
  {
    id: "assistant-bookings",
    name: "Assistant: bookings",
    description:
      "Office assistant for bookings: manage jobs, calendar, lost property and messages; view approvals, cases, laundry, properties and clients.",
    levels: levelsWith("off", {
      dashboard: "read",
      files: "read",
      jobs: "manage",
      calendar: "manage",
      approvals: "read",
      cases: "read",
      laundry: "read",
      "lost-found": "manage",
      properties: "read",
      clients: "read",
      communications: "manage",
    }),
    audience: "assistant",
  },
  {
    id: "assistant-finance",
    name: "Assistant: finance",
    description:
      "Office assistant for invoicing: manage client invoices; view jobs, clients, payroll and reports.",
    levels: levelsWith("off", {
      dashboard: "read",
      files: "read",
      jobs: "read",
      clients: "read",
      finance: "manage",
      payroll: "read",
      reports: "read",
    }),
    audience: "assistant",
  },
  {
    id: "restricted",
    name: "No access",
    description:
      "Start with every feature off and enable only what this person needs.",
    levels: allOpsLevels("off"),
    audience: "manager",
  },
] as const satisfies ReadonlyArray<{ id: string; name: string; description: string; levels: OpsLevels; audience: "manager" | "assistant" }>;

const ADMIN_SECTIONS: Record<string, OpsFeature | "owner"> = {
  "": "dashboard",
  activity: "dashboard",
  "nav-attention": "dashboard",
  // Command sections (GET /api/admin/command/[section]); rows inside are filtered per pack.
  command: "dashboard",
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
  // Approvals › Agent requests (step 6). Each decision also re-checks the action's own areas.
  "agent-requests": "approvals",
  // Agent accounts and tokens (Settings › Access › Agents): administrators only.
  agents: "owner",
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
  // People routes; /api/admin/people/cleaners is the workforce exception below.
  people: "accounts",
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
  // Insights (/v2/admin/reports) reads its figures from /api/admin/insights;
  // financial figures additionally need `finance` (lib/insights/access).
  insights: "reports",
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
  // Scheduling rules (2026-11-14): viewing follows Settings; every change is
  // ADMIN (or the scheduling.rules_edit grant) plus the person's own PIN.
  "scheduling-rules": "settings",
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
  // Settings > Access and permissions (its own page, 2026-11 redesign).
  access: "owner",
  "profile-permissions": "owner",
  portals: "owner",
  audit: "owner",
  restore: "owner",
  "invoice-cadence": "finance",
  "invoice-numbering": "finance",
  // The monthly Insights email chooses who gets the business summary: ADMIN only.
  "insights-email": "owner",
  // Required staff documents per role: read by the accounts screens (Wave E).
  "required-documents": "accounts",
};

export type OpsRequestFeature = OpsFeature | "owner" | "unmapped" | null;
/** Office message routes owned by the page they are sent from (see `opsRequestFeature`). */
const OFFICE_SEND_ROUTE_FEATURES: Readonly<Record<string, OpsFeature>> = {
  "supplier-chase": "laundry",
  "guest-message": "lost-found",
  "client-delay": "jobs",
};
/** Stable route ownership; special cases precede their parent section. */
/** Tabs of /admin/finance owned by the payroll feature. */
export const FINANCE_PAYROLL_TABS: ReadonlySet<string> = new Set(["cleaner-invoices", "payroll", "adjustments", "time"]);
/**
 * The merged Forms library page: QA templates stay a quality feature and
 * message templates a communications feature, as their old pages and their
 * APIs are. Every other tab (job forms, checklist blocks, results) is forms.
 */
export const FORMS_TAB_FEATURES: Readonly<Record<string, OpsFeature>> = { qa: "quality", messages: "communications" };
/**
 * The People page (/admin/accounts): its Clients tab belongs to the clients
 * pack and its Cleaners tab to the workforce pack, as the old Clients and
 * Workforce pages did. Every other tab stays with Staff accounts. Only the
 * page reads the tab; its data routes keep their own packs
 * (/api/admin/clients/* = clients, /api/admin/users = accounts).
 */
export const PEOPLE_TAB_FEATURES: Readonly<Record<string, OpsFeature>> = { clients: "clients", cleaners: "workforce" };

/**
 * Owner-only routes that an ADMIN can open to one person with an
 * administrator capability (owner decision 2026-11-12). The route itself
 * re-checks the grant and its guardrails (`lib/rbac/delegated-admin.ts`).
 */
const GRANTABLE_OWNER_ROUTES: ReadonlyArray<[RegExp, CapabilityKey]> = [
  [/^\/api\/admin\/users\/[^/]+\/reset-password\/?$/, "accounts.reset_password"],
  [/^\/api\/admin\/users\/[^/]+\/disable-2fa\/?$/, "accounts.reset_two_step"],
  [/^\/(?:api\/)?admin\/(?:impersonate|test-as(?:\/unlock)?|system\/test-as)\/?$/, "access.test_as"],
  [/^\/(?:api\/)?admin\/ops-permissions(?:\/[a-z-]+)?\/?$/, "access.edit_permissions"],
  [/^\/admin\/settings\/access\/?$/, "access.edit_permissions"],
];

function normalisedAdminPath(input: string): string {
  return new URL(input, "http://internal").pathname
    .replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "")
    .replace(/^\/v2(?=\/)/, "");
}

/** The administrator capability that opens this owner-only route, if any. */
export function ownerRouteCapability(input: string): CapabilityKey | null {
  const path = normalisedAdminPath(input);
  return GRANTABLE_OWNER_ROUTES.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

export function opsRequestFeature(input: string): OpsRequestFeature {
  const url = new URL(input, "http://internal");
  const path = url.pathname
    .replace(/^\/_accounts\/[a-f0-9]{32}(?=\/)/, "")
    .replace(/^\/v2(?=\/)/, "");
  if (
    /^\/(?:api\/)?admin\/users\/[^/]+\/(?:roles|password|reset-password|sessions|two-factor|disable-2fa)(?:\/|$)/.test(
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
  if (/^\/admin\/system\/test-as(?:\/|$)/.test(path)) return "owner";
  // Live ops and its live feeds are the dashboard pack (default pending owner
  // confirmation, 2026-11-14), not System: the same board Command shows. The
  // routes filter their payload by pack (continuations: approvals, drivers:
  // laundry). Other /admin/ops tools (e.g. the SLA run) stay System.
  if (/^\/(?:api\/)?admin\/ops(?:\/(?:live-locations|live-board|map|live-map)(?:\/|$)|\/?$)/.test(path)) return "dashboard";
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
  // The merged "Invoices and pay" page: its payee tabs belong to payroll, as
  // their APIs do. Only the page reads the tab; an API path cannot be steered
  // by a query string.
  // The cleaner invoice review page belongs to payroll, like its tab and API.
  if (/^\/admin\/finance\/cleaner-invoices(?:\/|$)/.test(path)) return "payroll";
  if (/^\/admin\/finance\/?$/.test(path)) {
    return FINANCE_PAYROLL_TABS.has(url.searchParams.get("tab") ?? "") ? "payroll" : "finance";
  }
  // The People › Cleaners list for workforce-pack viewers (forced to cleaners on the server).
  if (/^\/api\/admin\/people\/cleaners(?:\/export)?\/?$/.test(path)) return "workforce";
  if (/^\/admin\/accounts\/?$/.test(path)) {
    return PEOPLE_TAB_FEATURES[url.searchParams.get("tab") ?? ""] ?? "accounts";
  }
  if (/^\/admin\/forms\/?$/.test(path)) {
    return FORMS_TAB_FEATURES[url.searchParams.get("tab") ?? ""] ?? "forms";
  }
  // Office sends gated by the pack of the page they live on (owner decision
  // 2026-11-12, lib/notifications/office-send-rules.ts), not by the
  // notifications area's communications pack.
  const officeSend = /^\/api\/admin\/notifications\/actions\/([a-z-]+)\/?$/.exec(path)?.[1];
  if (officeSend && OFFICE_SEND_ROUTE_FEATURES[officeSend]) return OFFICE_SEND_ROUTE_FEATURES[officeSend];
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
  /** Administrator capabilities this person was granted (owner-only routes they may open). */
  grants: readonly CapabilityKey[] = [],
): boolean {
  const feature = opsRequestFeature(path);
  if (feature === "owner") {
    const capability = ownerRouteCapability(path);
    return capability !== null && grants.includes(capability);
  }
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
    (feature !== "unmapped" && opsLevelAllows(levels[feature], method))
  );
}

/** Keep a route into allowed settings when its general overview is disabled. */
export function opsNavigationHref(
  levels: OpsLevels | null,
  href: string,
): string | null {
  if (!levels || canUseOpsPath(levels, href)) return href;
  // A manager with payroll but not finance still reaches the payee tabs.
  if (/^\/(?:v2\/)?admin\/finance$/.test(href) && canUseOpsPath(levels, `${href}?tab=cleaner-invoices`)) {
    return `${href}?tab=cleaner-invoices`;
  }
  // A manager with QA templates or message templates but not forms still
  // reaches those tabs of the merged Forms page.
  if (/^\/(?:v2\/)?admin\/forms$/.test(href)) {
    const tab = Object.keys(FORMS_TAB_FEATURES).find((key) => canUseOpsPath(levels, `${href}?tab=${key}`));
    if (tab) return `${href}?tab=${tab}`;
  }
  // People: a manager with clients or workforce but not accounts reaches their tab.
  if (/^\/(?:v2\/)?admin\/accounts$/.test(href)) {
    const tab = Object.keys(PEOPLE_TAB_FEATURES).find((key) => canUseOpsPath(levels, `${href}?tab=${key}`));
    if (tab) return `${href}?tab=${tab}`;
  }
  if (/^\/(?:v2\/)?admin\/settings$/.test(href)) {
    const tab = Object.keys(SETTINGS_TABS).find((key) =>
      canUseOpsPath(levels, `${href}?tab=${key}`),
    );
    if (tab) return `${href}?tab=${tab}`;
  }
  return null;
}
