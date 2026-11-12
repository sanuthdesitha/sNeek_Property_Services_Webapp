/**
 * Server guardrails for a NON-administrator saving access changes with the
 * "Edit access and permissions" capability (owner decision 2026-11-12). Pure:
 * the route feeds it the stored policy, the proposed policy, the actor and
 * the live roles of every person whose assignment changed.
 *
 * A delegated editor may never:
 * - change their own access (also enforced for everyone in saveOpsPolicy);
 * - create, change or remove presets (that would move many people at once);
 * - grant or withdraw administrator capabilities (ADMIN only);
 * - touch an administrator's entry;
 * - touch anyone whose access exceeds theirs, before or after the change
 *   (so nobody receives anything the editor does not hold).
 */
import { GRANT_CAPABILITY_KEYS } from "./capabilities";
import { accessWithin, isAdministrator, type AccessSubject } from "./access-evaluator";
import type { OpsPolicy } from "./ops-policy";

export type DelegatedRefusal =
  | "SELF"
  | "PRESETS"
  | "ADMIN_CAPABILITIES"
  | "ADMIN_TARGET"
  | "UNKNOWN_PERSON"
  | "EXCEEDS_OWN_ACCESS";

export const DELEGATED_REFUSAL_TEXT: Record<DelegatedRefusal, string> = {
  SELF: "You cannot change your own access.",
  PRESETS: "Only administrators can create, change or remove presets.",
  ADMIN_CAPABILITIES: "Only administrators can grant or withdraw administrator capabilities.",
  ADMIN_TARGET: "Administrators' access cannot be changed here.",
  UNKNOWN_PERSON: "One of these people no longer exists or has no account.",
  EXCEEDS_OWN_ACCESS: "You can only change the access of people whose access does not exceed yours, and only up to your own access.",
};

const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export function delegatedPolicyRefusal(
  before: OpsPolicy,
  after: OpsPolicy,
  actor: AccessSubject,
  subjects: Readonly<Record<string, AccessSubject>>,
): DelegatedRefusal | null {
  if (isAdministrator(actor)) return null;
  if (!same(before.presets, after.presets)) return "PRESETS";
  const people = new Set([...Object.keys(before.assignments), ...Object.keys(after.assignments)]);
  for (const id of Array.from(people)) {
    const from = before.assignments[id];
    const to = after.assignments[id];
    if (same(from, to)) continue;
    if (id === actor.id) return "SELF";
    if (GRANT_CAPABILITY_KEYS.some((key) => from?.capabilities?.[key] !== to?.capabilities?.[key])) return "ADMIN_CAPABILITIES";
    const subject = subjects[id];
    if (!subject) return "UNKNOWN_PERSON";
    if (isAdministrator(subject)) return "ADMIN_TARGET";
    if (!accessWithin(before, subject, actor) || !accessWithin(after, subject, actor)) return "EXCEEDS_OWN_ACCESS";
  }
  return null;
}
