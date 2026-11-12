/**
 * Activity log presentation (owner board "Activity", 2026-11). Plain module:
 * categories for the chips, a plain sentence for each audit row, the actual
 * person versus the person they were testing as, and a field-by-field diff of
 * `before` / `after` (the raw JSON stays available underneath).
 */
import { SYSTEM_ACTOR_LABELS, systemActorOf } from "@/lib/audit/system-actor";

export const ACTIVITY_CATEGORIES = ["all", "access", "money", "jobs", "settings", "testing", "system"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  all: "Everything",
  access: "Access and accounts",
  money: "Money",
  jobs: "Jobs",
  settings: "Settings",
  testing: "Done while testing as someone",
  system: "System",
};

/** Record types (AuditLog.entity) behind each kind-of-change chip. */
export const CATEGORY_ENTITIES: Record<"access" | "money" | "jobs" | "settings", readonly string[]> = {
  access: ["User", "Client", "VaTeam", "RetainedAccountLink", "UserEmailPreference", "StaffDocument", "Branch"],
  money: ["ClientInvoice", "CleanerPayAdjustment", "CleanerInvoiceSubmission", "PayrollRun", "InvoiceSequence", "PriceBook", "HolidayRates", "ShoppingClientCharge", "Quote", "QuoteLead", "ClientApproval"],
  jobs: ["Job", "JobTask", "JobAssignment", "TimeLog", "TimeLogAdjustmentRequest", "JobEarlyCheckoutRequest", "JobContinuationRequest", "JobImport", "LaundryTask", "FormSubmission"],
  settings: ["AppSettings", "AppSetting", "FormTemplate", "QaFormTemplate", "ChecklistModule", "ChecklistModuleItem", "CommercialSlaRule"],
};

export const ACTIVITY_PERIODS = ["7", "30", "90", "all"] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];
export const ACTIVITY_PERIOD_LABELS: Record<ActivityPeriod, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", all: "All time" };

type Json = unknown;

function record(value: Json): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The account that really acted while "testing as" someone, when the row recorded it. */
export function impersonatorIdOf(after: Json): string | null {
  const fields = record(after);
  const id = fields?.impersonatedBy ?? fields?.impersonationActorId;
  return typeof id === "string" && id.trim() ? id : null;
}

const VERBS: Array<[RegExp, string]> = [
  [/^(CREATE|CREATED|ADD|ADDED)_?/, "Created"],
  [/^(UPDATE|UPDATED|EDIT|EDITED|PATCH)_?/, "Updated"],
  [/^(DELETE|DELETED|REMOVE|REMOVED)_?/, "Deleted"],
  [/^(APPROVE|APPROVED)_?/, "Approved"],
  [/^(REJECT|REJECTED|DECLINE|DECLINED)_?/, "Declined"],
  [/^(SEND|SENT)_?/, "Sent"],
  [/^(RESET)_?/, "Reset"],
];

function words(value: string): string {
  return value.replace(/[._]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
}

/**
 * "Updated job status · Job" style sentence from the stored action and record
 * type. Approval decisions read from their own payload. Unknown actions keep
 * their words rather than being guessed at.
 */
export function activitySentence(action: string, entity: string, after: Json): string {
  if (action === "APPROVAL_DECISION") {
    const payload = record(after);
    const decision = typeof payload?.decision === "string" ? payload.decision.toLowerCase() : "decided";
    const label = typeof payload?.label === "string" ? payload.label : words(entity);
    return `${decision.charAt(0).toUpperCase()}${decision.slice(1)} ${label}${typeof payload?.subjectName === "string" ? ` for ${payload.subjectName}` : ""}`;
  }
  const upper = action.toUpperCase();
  for (const [pattern, verb] of VERBS) {
    if (pattern.test(upper)) {
      const rest = words(upper.replace(pattern, ""));
      return `${verb} ${rest || words(entity)}`;
    }
  }
  const text = words(action);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type FieldChange = { field: string; before: string; after: string };

function show(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "empty";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 157)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

const HIDDEN_FIELDS = new Set(["impersonatedBy", "impersonationActorId", "systemActor", "passwordHash", "adminPinHash", "token", "secret"]);

/** Top-level fields that differ between before and after (both objects), in key order. */
export function fieldChanges(before: Json, after: Json): FieldChange[] {
  const a = record(before);
  const b = record(after);
  if (!a && !b) return [];
  const keys = Array.from(new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])).filter((key) => !HIDDEN_FIELDS.has(key));
  return keys
    .filter((key) => JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key]))
    .map((key) => ({ field: words(key), before: show(a?.[key]), after: show(b?.[key]) }));
}

export type ActivityPerson = { name: string; role: string | null };

export type ActivityRowView = {
  id: string;
  at: string;
  sentence: string;
  entity: string;
  entityId: string;
  jobId: string | null;
  /** Who really did it: the system, the person testing, or the signed-in person. */
  actual: ActivityPerson;
  /** Set only when the action was taken while testing as this person. */
  testingAs: ActivityPerson | null;
  changes: FieldChange[];
  before: Json;
  after: Json;
  ipAddress: string | null;
};

type AuditRowInput = {
  id: string;
  createdAt: Date | string;
  action: string;
  entity: string;
  entityId: string;
  jobId: string | null;
  before: Json;
  after: Json;
  ipAddress: string | null;
  user: { name: string | null; email: string; role: string } | null;
};

function personOf(user: { name: string | null; email: string; role: string } | null | undefined): ActivityPerson {
  return { name: user?.name || user?.email || "Unknown account", role: user ? user.role.replace(/_/g, " ").toLowerCase() : null };
}

/** One row as shown. `impersonators` maps an actual actor id to that account. */
export function toActivityRow(row: AuditRowInput, impersonators: Map<string, { name: string | null; email: string; role: string }>): ActivityRowView {
  const system = systemActorOf(row.after);
  const actorId = impersonatorIdOf(row.after);
  const actualAccount = actorId ? impersonators.get(actorId) : null;
  const actual: ActivityPerson = system
    ? { name: SYSTEM_ACTOR_LABELS[system], role: "scheduled worker" }
    : actorId
      ? actualAccount
        ? personOf(actualAccount)
        : { name: "Unknown account (testing)", role: null }
      : personOf(row.user);
  return {
    id: row.id,
    at: new Date(row.createdAt).toISOString(),
    sentence: activitySentence(row.action, row.entity, row.after),
    entity: row.entity,
    entityId: row.entityId,
    jobId: row.jobId,
    actual,
    testingAs: actorId && !system ? personOf(row.user) : null,
    changes: fieldChanges(row.before, row.after),
    before: row.before,
    after: row.after,
    ipAddress: row.ipAddress,
  };
}
