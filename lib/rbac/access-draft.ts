/**
 * Draft edits on the access policy (pure). The screen edits a copy of the
 * stored policy with these, and nothing applies until "Review and save".
 */
import { personChanges } from "./access-diff";
import { capabilityDefinition, GRANT_CAPABILITY_KEYS, type CapabilityKey } from "./capabilities";
import { OPS_FEATURE_KEYS, type AccessLevel, type OpsFeature } from "./ops-catalog";
import {
  findPreset,
  resolveAccessLevels,
  type CapabilityOverrides,
  type OpsAssignment,
  type OpsCustomPreset,
  type OpsPolicy,
} from "./ops-policy";

function assignmentOf(policy: OpsPolicy, userId: string): OpsAssignment {
  return policy.assignments[userId] ?? { presetId: "existing", overrides: {} };
}

function withAssignment(policy: OpsPolicy, userId: string, assignment: OpsAssignment): OpsPolicy {
  return { ...policy, assignments: { ...policy.assignments, [userId]: tidy(assignment) } };
}

/** Drop empty optional maps so an unchanged person compares equal. */
function tidy(assignment: OpsAssignment): OpsAssignment {
  const next: OpsAssignment = { presetId: assignment.presetId, overrides: assignment.overrides };
  if (assignment.sensitive && Object.keys(assignment.sensitive).length) next.sensitive = assignment.sensitive;
  if (assignment.capabilities && Object.keys(assignment.capabilities).length) next.capabilities = assignment.capabilities;
  return next;
}

function grantsOnly(capabilities: CapabilityOverrides | undefined): CapabilityOverrides {
  return Object.fromEntries(
    Object.entries(capabilities ?? {}).filter(([key]) => GRANT_CAPABILITY_KEYS.includes(key as CapabilityKey)),
  ) as CapabilityOverrides;
}

export function setPersonLevel(policy: OpsPolicy, userId: string, area: OpsFeature, level: AccessLevel): OpsPolicy {
  const assignment = assignmentOf(policy, userId);
  const presetLevel = findPreset(policy, assignment.presetId)?.levels[area] ?? "off";
  const overrides = { ...assignment.overrides };
  if (level === presetLevel) delete overrides[area];
  else overrides[area] = level;
  return withAssignment(policy, userId, { ...assignment, overrides });
}

/** The header "Full access" switch: every area at Full, or back to the preset's levels. */
export function setPersonFullAccess(policy: OpsPolicy, userId: string, on: boolean): OpsPolicy {
  const assignment = assignmentOf(policy, userId);
  const overrides = on ? Object.fromEntries(OPS_FEATURE_KEYS.map((key) => [key, "full" as const])) : {};
  return withAssignment(policy, userId, { ...assignment, overrides });
}

export function isFullAccess(policy: OpsPolicy, userId: string): boolean {
  const levels = resolveAccessLevels(policy, userId);
  return OPS_FEATURE_KEYS.every((key) => levels[key] === "full");
}

/**
 * Switch one capability. Manage tier: off stores `false`, on removes it.
 * Full tier: uses the sensitive grant (off at Full stores `false`; on at
 * Manage keeps an earlier individual grant only by removing a refusal).
 * Grant tier: on stores `true`, off removes it.
 */
export function setPersonCapability(policy: OpsPolicy, userId: string, key: CapabilityKey, on: boolean): OpsPolicy {
  const capability = capabilityDefinition(key);
  const assignment = assignmentOf(policy, userId);
  if (capability.tier === "full" && capability.sensitiveAction) {
    const sensitive = { ...assignment.sensitive };
    const level = resolveAccessLevels(policy, userId)[capability.area as OpsFeature];
    if (on) {
      if (level === "full") delete sensitive[capability.sensitiveAction];
      else sensitive[capability.sensitiveAction] = true;
    } else if (level === "full") sensitive[capability.sensitiveAction] = false;
    else delete sensitive[capability.sensitiveAction];
    return withAssignment(policy, userId, { ...assignment, sensitive });
  }
  const capabilities = { ...assignment.capabilities };
  if (capability.tier === "grant") {
    if (on) capabilities[key] = true;
    else delete capabilities[key];
  } else if (capability.tier === "manage") {
    if (on) delete capabilities[key];
    else capabilities[key] = false;
  }
  return withAssignment(policy, userId, { ...assignment, capabilities });
}

/** "Start from": the preset's levels; individual switches go, administrator grants stay. */
export function applyPreset(policy: OpsPolicy, userId: string, presetId: string): OpsPolicy {
  const assignment = assignmentOf(policy, userId);
  return withAssignment(policy, userId, { presetId, overrides: {}, capabilities: grantsOnly(assignment.capabilities) });
}

/** "Copy access from…": everything but the administrator grants, which stay the target's own. */
export function copyAccess(policy: OpsPolicy, fromId: string, toId: string): OpsPolicy {
  const source = assignmentOf(policy, fromId);
  const target = assignmentOf(policy, toId);
  const copied = Object.fromEntries(
    Object.entries(source.capabilities ?? {}).filter(([key]) => !GRANT_CAPABILITY_KEYS.includes(key as CapabilityKey)),
  );
  return withAssignment(policy, toId, {
    presetId: source.presetId,
    overrides: { ...source.overrides },
    sensitive: source.sensitive ? { ...source.sensitive } : undefined,
    capabilities: { ...copied, ...grantsOnly(target.capabilities) },
  });
}

/** Undo every unsaved change for one person. */
export function revertPerson(draft: OpsPolicy, saved: OpsPolicy, userId: string): OpsPolicy {
  const assignments = { ...draft.assignments };
  if (saved.assignments[userId]) assignments[userId] = saved.assignments[userId];
  else delete assignments[userId];
  return { ...draft, assignments };
}

// ─── Presets (administrators only; the server refuses delegated preset edits) ───

export function createPreset(policy: OpsPolicy, name: string, fromUserId: string | null): { policy: OpsPolicy; id: string } {
  const id = `custom-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
  const levels = fromUserId ? resolveAccessLevels(policy, fromUserId) : Object.fromEntries(OPS_FEATURE_KEYS.map((key) => [key, "off" as const]));
  const preset: OpsCustomPreset = { id, name, description: "", levels, audience: "manager" };
  return { policy: { ...policy, presets: [...policy.presets, preset] }, id };
}

export function updatePreset(policy: OpsPolicy, id: string, change: Partial<Pick<OpsCustomPreset, "name" | "description" | "audience">>): OpsPolicy {
  return { ...policy, presets: policy.presets.map((preset) => (preset.id === id ? { ...preset, ...change } : preset)) };
}

export function setPresetLevel(policy: OpsPolicy, id: string, area: OpsFeature, level: AccessLevel): OpsPolicy {
  return { ...policy, presets: policy.presets.map((preset) => (preset.id === id ? { ...preset, levels: { ...preset.levels, [area]: level } } : preset)) };
}

export function presetUsers(policy: OpsPolicy, id: string): string[] {
  return Object.entries(policy.assignments).filter(([, assignment]) => assignment.presetId === id).map(([userId]) => userId);
}

/** Only an unused custom preset can be removed (assignments must reference a preset). */
export function deletePreset(policy: OpsPolicy, id: string): OpsPolicy {
  if (presetUsers(policy, id).length) return policy;
  return { ...policy, presets: policy.presets.filter((preset) => preset.id !== id) };
}

export function changedPeople(draft: OpsPolicy, saved: OpsPolicy): string[] {
  const ids = new Set([...Object.keys(draft.assignments), ...Object.keys(saved.assignments)]);
  // Compared by effect, so setting a level back to where it was is no change.
  return Array.from(ids).filter((id) => personChanges(saved, draft, id).length > 0);
}
