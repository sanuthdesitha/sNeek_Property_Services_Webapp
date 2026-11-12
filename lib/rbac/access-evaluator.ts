/**
 * The ONE capability evaluator (pure). `lib/rbac/can.ts` feeds it the live
 * policy and session; the access screen feeds it a draft policy to preview.
 *
 * Effective access of an operations-pack subject:
 *   area level   = person's override ?? preset level ?? Off
 *                  (no assignment at all: every area at Manage, the
 *                  backwards-compatible default)
 *   view tier    = area at View or above
 *   manage tier  = area at Manage or Full, and no `false` switch
 *                  (person's switch beats the preset's)
 *   full tier    = area at Manage or Full, and the sensitive grant:
 *                  explicit grant (person, then custom preset) ?? (area is Full)
 *
 * Anyone holding ADMIN is an administrator: every capability, never a pack.
 * Any other non-subject (cleaner, client, ...) has none; their own routes keep
 * their own guards.
 */
import { capabilityDefinition, CAPABILITIES, type CapabilityKey } from "./capabilities";
import type { AccessLevel, AccessLevels } from "./ops-catalog";
import {
  isOpsSubject,
  resolveAccessLevels,
  resolveCapabilityOverrides,
  resolveSensitiveGrants,
  type OpsPolicy,
} from "./ops-policy";

export type AccessSubject = { id: string; role: string; heldRoles?: readonly string[] };

export function isAdministrator(subject: AccessSubject): boolean {
  return subject.role === "ADMIN" || (subject.heldRoles ?? []).includes("ADMIN");
}

function atLeastView(level: AccessLevel): boolean {
  return level !== "off";
}

function atLeastManage(level: AccessLevel): boolean {
  return level === "manage" || level === "full";
}

/** Evaluate one capability for an operations-pack subject from resolved parts. */
export function capabilityFromParts(
  key: CapabilityKey,
  levels: AccessLevels,
  overrides: Partial<Record<CapabilityKey, boolean>>,
  sensitive: Partial<Record<string, boolean>>,
): boolean {
  const capability = capabilityDefinition(key);
  const level = levels[capability.area];
  if (capability.tier === "view") return atLeastView(level);
  if (!atLeastManage(level)) return false;
  if (capability.tier === "manage") return overrides[key] !== false;
  const explicit = capability.sensitiveAction ? sensitive[capability.sensitiveAction] : undefined;
  return (explicit ?? level === "full") === true;
}

export function evaluateCapability(policy: OpsPolicy, subject: AccessSubject, key: CapabilityKey): boolean {
  if (isAdministrator(subject)) return true;
  if (!isOpsSubject({ role: subject.role, heldRoles: subject.heldRoles ? [...subject.heldRoles] : undefined })) return false;
  return capabilityFromParts(
    key,
    resolveAccessLevels(policy, subject.id),
    resolveCapabilityOverrides(policy, subject.id),
    resolveSensitiveGrants(policy, subject.id),
  );
}

export type CapabilityMap = Record<CapabilityKey, boolean>;

/** Every capability for a person, from a (possibly draft) policy. */
export function effectiveCapabilities(policy: OpsPolicy, userId: string): CapabilityMap {
  const levels = resolveAccessLevels(policy, userId);
  const overrides = resolveCapabilityOverrides(policy, userId);
  const sensitive = resolveSensitiveGrants(policy, userId);
  return Object.fromEntries(
    CAPABILITIES.map((capability) => [capability.key, capabilityFromParts(capability.key, levels, overrides, sensitive)]),
  ) as CapabilityMap;
}

/** Where a capability's state comes from, for the screen's hint line. */
export type CapabilitySource = "level" | "needs-view" | "needs-manage" | "needs-full" | "switched-off" | "granted-individually" | "full-switched-off";

export function capabilitySource(policy: OpsPolicy, userId: string, key: CapabilityKey): CapabilitySource {
  const capability = capabilityDefinition(key);
  const level = resolveAccessLevels(policy, userId)[capability.area];
  if (capability.tier === "view") return atLeastView(level) ? "level" : "needs-view";
  if (!atLeastManage(level)) return "needs-manage";
  if (capability.tier === "manage") return resolveCapabilityOverrides(policy, userId)[key] === false ? "switched-off" : "level";
  const explicit = capability.sensitiveAction ? resolveSensitiveGrants(policy, userId)[capability.sensitiveAction] : undefined;
  if (level === "full") return explicit === false ? "full-switched-off" : "level";
  return explicit === true ? "granted-individually" : "needs-full";
}
