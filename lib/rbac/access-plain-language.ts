/**
 * "What <name> can do", written from the levels and capabilities (pure). The
 * screen compares the draft against the saved policy to mark new lines.
 */
import { effectiveCapabilities } from "./access-evaluator";
import { CAPABILITIES, type CapabilityDefinition } from "./capabilities";
import { OPS_FEATURES, type OpsFeature } from "./ops-catalog";
import { resolveAccessLevels, type OpsPolicy } from "./ops-policy";

/** What Manage means for each area, in a sentence. */
const MANAGE_TEXT: Record<OpsFeature, string> = {
  files: "Upload and manage shared files and media",
  dashboard: "Use the command centre and today's activity",
  jobs: "Create, reschedule and assign jobs",
  calendar: "Manage the calendar and recurring jobs",
  approvals: "Approve or decline requests in Approvals",
  cases: "Open and follow up cases and issues",
  quality: "Run QA reviews and quality records",
  laundry: "Run laundry: planning, tracking and suppliers",
  inventory: "Manage stock, purchasing and shopping runs",
  maintenance: "Coordinate maintenance tickets",
  "lost-found": "Record lost property and follow it up",
  properties: "Edit property records, rate cards and care plans",
  clients: "Edit client records and contacts",
  accounts: "Administer staff accounts (not roles or security)",
  workforce: "Manage the cleaner roster, compliance and coaching",
  hiring: "Run hiring: positions and applications",
  onboarding: "Run property onboarding and surveys",
  forms: "Edit forms and checklists",
  reports: "Build, export and share reports",
  quotes: "Prepare quotes and work leads",
  finance: "Work on client invoices and subscriptions",
  payroll: "Review payroll, cleaner invoices and pay adjustments",
  pricing: "Change pricing and holiday rates",
  communications: "Use the message centre and templates",
  marketing: "Run campaigns and email marketing",
  website: "Edit website content and blog posts",
  settings: "Change general settings",
  "property-form": "Change the property form",
  "laundry-settings": "Change laundry settings",
  "notification-settings": "Change notification schedules and channels",
  "quality-settings": "Change quality and safeguard settings",
  integrations: "Run integration diagnostics and calendar sync",
  ai: "Use AI tools",
  system: "Use system diagnostics and automation",
};

function shortName(area: OpsFeature): string {
  const label = OPS_FEATURES.find((feature) => feature.key === area)?.label ?? area;
  return label.replace(/ & /g, " and ").toLowerCase();
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type PlainLanguageAccess = { can: string[]; cannot: string[] };

export function describeAccess(policy: OpsPolicy, userId: string): PlainLanguageAccess {
  const levels = resolveAccessLevels(policy, userId);
  const capabilities = effectiveCapabilities(policy, userId);
  const can: string[] = [];
  const cannot: string[] = [];
  const viewed: string[] = [];
  const off: string[] = [];
  for (const feature of OPS_FEATURES) {
    const level = levels[feature.key];
    if (level === "manage" || level === "full") can.push(MANAGE_TEXT[feature.key]);
    else if (level === "read") viewed.push(shortName(feature.key));
    else off.push(shortName(feature.key));
  }
  const allowedExtras = CAPABILITIES.filter(
    (capability: CapabilityDefinition) => (capability.tier === "full" || capability.tier === "grant") && capabilities[capability.key as keyof typeof capabilities],
  );
  can.push(...allowedExtras.map((capability) => capability.canText));
  if (viewed.length) can.push(`Look at ${joinNames(viewed)}`);

  for (const capability of CAPABILITIES as readonly CapabilityDefinition[]) {
    if (capability.tier === "view" || capability.tier === "grant" || capability.area === null) continue;
    if (levels[capability.area] === "off") continue;
    if (!capabilities[capability.key as keyof typeof capabilities]) cannot.push(capability.cannotText);
  }
  if (off.length) cannot.push(off.length > 6 ? `Open ${off.length} areas that are Off (${joinNames(off.slice(0, 3))} and more)` : `Open ${joinNames(off)}`);
  const missingGrants = CAPABILITIES.filter((capability) => capability.tier === "grant" && !capabilities[capability.key]);
  if (missingGrants.length) cannot.push(missingGrants.length === CAPABILITIES.filter((capability) => capability.tier === "grant").length
    ? "Reset passwords or two-step, use Test as, or change anyone's access"
    : missingGrants.map((capability) => capability.cannotText).join("; "));
  return { can, cannot };
}

/** Lines in the draft description that are not in the saved one. */
export function newLines(draft: PlainLanguageAccess, saved: PlainLanguageAccess): Set<string> {
  const before = new Set(saved.can);
  return new Set(draft.can.filter((line) => !before.has(line)));
}
