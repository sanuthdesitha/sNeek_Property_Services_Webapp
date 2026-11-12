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
 *   grant tier   = an explicit `true` on the person (administrator
 *                  capabilities; presets cannot carry them)
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
  if (capability.tier === "grant" || capability.area === null) return overrides[key] === true;
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
  if (capability.tier === "grant" || capability.area === null) {
    return resolveCapabilityOverrides(policy, userId)[key] === true ? "granted-individually" : "needs-full";
  }
  const level = resolveAccessLevels(policy, userId)[capability.area];
  if (capability.tier === "view") return atLeastView(level) ? "level" : "needs-view";
  if (!atLeastManage(level)) return "needs-manage";
  if (capability.tier === "manage") return resolveCapabilityOverrides(policy, userId)[key] === false ? "switched-off" : "level";
  const explicit = capability.sensitiveAction ? resolveSensitiveGrants(policy, userId)[capability.sensitiveAction] : undefined;
  if (level === "full") return explicit === false ? "full-switched-off" : "level";
  return explicit === true ? "granted-individually" : "needs-full";
}

const LEVEL_RANK: Record<AccessLevel, number> = { off: 0, read: 1, manage: 2, full: 3 };

/**
 * Guardrail for delegated administrator capabilities: is everything the
 * target can do also something the actor can do?
 * - an administrator target is within reach of administrators only;
 * - an administrator actor reaches everyone;
 * - a target with no office access (cleaner, client, ...) is within reach;
 * - an office target is within reach when no area level and no capability
 *   (administrator capabilities included) exceeds the actor's.
 */
export function accessWithin(policy: OpsPolicy, target: AccessSubject, actor: AccessSubject): boolean {
  if (isAdministrator(target)) return isAdministrator(actor);
  if (isAdministrator(actor)) return true;
  const targetIsOffice = isOpsSubject({ role: target.role, heldRoles: target.heldRoles ? [...target.heldRoles] : undefined });
  if (!targetIsOffice) return true;
  const actorIsOffice = isOpsSubject({ role: actor.role, heldRoles: actor.heldRoles ? [...actor.heldRoles] : undefined });
  if (!actorIsOffice) return false;
  const targetLevels = resolveAccessLevels(policy, target.id);
  const actorLevels = resolveAccessLevels(policy, actor.id);
  for (const area of Object.keys(targetLevels) as Array<keyof AccessLevels>) {
    if (LEVEL_RANK[targetLevels[area]] > LEVEL_RANK[actorLevels[area]]) return false;
  }
  const targetCapabilities = effectiveCapabilities(policy, target.id);
  const actorCapabilities = effectiveCapabilities(policy, actor.id);
  return CAPABILITIES.every((capability) => !targetCapabilities[capability.key] || actorCapabilities[capability.key]);
}
