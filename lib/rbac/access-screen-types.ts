/**
 * Data shapes and pure helpers for Settings > Access and permissions. Plain
 * module (no "use client"): the route, the page and the client components all
 * read it.
 */
import { CAPABILITIES, type CapabilityKey } from "./capabilities";
import { effectiveCapabilities } from "./access-evaluator";
import { OPS_FEATURES } from "./ops-catalog";
import { findPreset, isOpsSubject, resolveAccessLevels, type OpsPolicy } from "./ops-policy";

export type AccessPerson = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  heldRoles: string[];
  twoFactorEnabled: boolean;
  createdAt: string;
};

export type AssistantTeam = {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  memberCount: number;
  isActive: boolean;
};

export type AccessHistoryEntry = {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  /** Person id or `preset:<id>`. */
  subjectId: string;
  text: string;
};

export type AccessViewer = {
  id: string;
  isAdmin: boolean;
  /** Administrator capabilities the viewer holds (all of them for an administrator). */
  grants: CapabilityKey[];
};

export type AccessScreenData = {
  policy: OpsPolicy;
  people: AccessPerson[];
  ownPortalCounts: Record<string, number>;
  assistantTeams: AssistantTeam[];
  history: AccessHistoryEntry[];
  viewer: AccessViewer;
  timeZone: string;
};

export type PersonGroup = "admin" | "manager" | "assistant" | "other";

export const PERSON_GROUP_LABELS: Record<PersonGroup, string> = {
  admin: "Administrators",
  manager: "Operations managers",
  assistant: "Office assistants",
  other: "Other staff with office access",
};

export const ROLE_NAMES: Record<string, string> = {
  ADMIN: "Administrator",
  OPS_MANAGER: "Operations manager",
  QA_INSPECTOR: "QA inspector",
  CLEANER: "Cleaner",
  CLIENT: "Client",
  LAUNDRY: "Laundry team",
  MAINTENANCE: "Maintenance",
  VA: "Client assistant",
};

export function isAdminPerson(person: Pick<AccessPerson, "role" | "heldRoles">): boolean {
  return person.role === "ADMIN" || person.heldRoles.includes("ADMIN");
}

/** The list a person appears in; a draft preset change can move them. */
export function personGroup(policy: OpsPolicy, person: AccessPerson): PersonGroup {
  if (isAdminPerson(person)) return "admin";
  if (person.role !== "OPS_MANAGER") return "other";
  const assignment = policy.assignments[person.id];
  const preset = findPreset(policy, assignment?.presetId ?? "existing");
  return preset?.audience === "assistant" ? "assistant" : "manager";
}

export function isOfficePerson(person: AccessPerson): boolean {
  return isAdminPerson(person) || isOpsSubject({ role: person.role, heldRoles: person.heldRoles });
}

export const TOTAL_AREAS = OPS_FEATURES.length;

export type AccessSummary = { on: number; manage: number; view: number; full: number; capabilitiesOff: number };

export function accessSummary(policy: OpsPolicy, userId: string): AccessSummary {
  const levels = resolveAccessLevels(policy, userId);
  const values = OPS_FEATURES.map((feature) => levels[feature.key]);
  const capabilities = effectiveCapabilities(policy, userId);
  const capabilitiesOff = CAPABILITIES.filter((capability) => capability.tier === "manage" && !capabilities[capability.key] && capability.area !== null && levels[capability.area] !== "off" && levels[capability.area] !== "read").length;
  return {
    on: values.filter((value) => value !== "off").length,
    manage: values.filter((value) => value === "manage").length,
    view: values.filter((value) => value === "read").length,
    full: values.filter((value) => value === "full").length,
    capabilitiesOff,
  };
}

/** One line under the name in the people list: "Coordinator · 6 Manage, 28 View". */
export function personSummaryLine(policy: OpsPolicy, person: AccessPerson): string {
  if (isAdminPerson(person)) return "Full access (administrator)";
  const preset = findPreset(policy, policy.assignments[person.id]?.presetId ?? "existing")?.name ?? "Custom";
  const summary = accessSummary(policy, person.id);
  const prefix = person.role === "OPS_MANAGER" ? preset : `${ROLE_NAMES[person.role] ?? person.role} + ${preset}`;
  if (summary.on === 0) return `${prefix} · no areas`;
  if (summary.on === TOTAL_AREAS && summary.manage === TOTAL_AREAS) return `${prefix} · all ${TOTAL_AREAS}, Manage`;
  if (summary.on === TOTAL_AREAS && summary.view === TOTAL_AREAS) return `${prefix} · ${TOTAL_AREAS} of ${TOTAL_AREAS}, View`;
  return `${prefix} · ${summary.on} of ${TOTAL_AREAS} areas`;
}

export const STALE_REVIEW_DAYS = 90;

/** Last saved change for a person (from history), or null. */
export function lastReviewed(history: AccessHistoryEntry[], userId: string): AccessHistoryEntry | null {
  return history.find((entry) => entry.subjectId === userId) ?? null;
}

export function isStale(history: AccessHistoryEntry[], person: AccessPerson, now: Date): boolean {
  if (isAdminPerson(person)) return false;
  const last = lastReviewed(history, person.id);
  const since = new Date(last?.at ?? person.createdAt).getTime();
  return now.getTime() - since > STALE_REVIEW_DAYS * 86_400_000;
}
