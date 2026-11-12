/**
 * Plain-language differences between two policies (pure). Used for the
 * unsaved-changes bar, the conflict view and the change history, so all three
 * describe a change the same way ("Finance and invoicing: Off -> View").
 */
import { capabilityDefinition, CAPABILITY_KEYS, SENSITIVE_ACTION_CAPABILITY, type CapabilityKey } from "./capabilities";
import { ACCESS_LEVEL_LABELS, OPS_FEATURES, type AccessLevel } from "./ops-catalog";
import { findPreset, resolveAccessLevels, type OpsPolicy } from "./ops-policy";
import type { SensitiveAction } from "@/lib/security/sensitive-actions";

export type AccessChange = { subject: { kind: "person"; id: string } | { kind: "preset"; id: string; name: string }; text: string };

const levelLabel = (level: AccessLevel) => ACCESS_LEVEL_LABELS[level];

function levelChanges(before: Record<string, AccessLevel>, after: Record<string, AccessLevel>): string[] {
  return OPS_FEATURES.flatMap((feature) => {
    const from = before[feature.key];
    const to = after[feature.key];
    return from === to ? [] : [`${feature.label.replace(/ & /g, " and ")}: ${levelLabel(from)} → ${levelLabel(to)}`];
  });
}

function switchChanges(
  before: Partial<Record<CapabilityKey, boolean>> | undefined,
  after: Partial<Record<CapabilityKey, boolean>> | undefined,
): string[] {
  return CAPABILITY_KEYS.flatMap((key) => {
    const from = before?.[key];
    const to = after?.[key];
    if (from === to) return [];
    const label = capabilityDefinition(key).label;
    return [to === false ? `Switched off: ${label}` : `Switched back on: ${label}`];
  });
}

function sensitiveChanges(
  before: Partial<Record<SensitiveAction, boolean>> | undefined,
  after: Partial<Record<SensitiveAction, boolean>> | undefined,
): string[] {
  return (Object.keys(SENSITIVE_ACTION_CAPABILITY) as SensitiveAction[]).flatMap((action) => {
    const from = before?.[action];
    const to = after?.[action];
    if (from === to) return [];
    const label = capabilityDefinition(SENSITIVE_ACTION_CAPABILITY[action]).label;
    if (to === true) return [`Granted: ${label}`];
    if (to === false) return [`Withheld: ${label}`];
    return [`Follows the level again: ${label}`];
  });
}

/** Changes to one person's effective setup (preset, levels, switches, grants). */
export function personChanges(before: OpsPolicy, after: OpsPolicy, userId: string): string[] {
  const from = before.assignments[userId];
  const to = after.assignments[userId];
  const lines: string[] = [];
  const fromPreset = from ? findPreset(before, from.presetId)?.name ?? from.presetId : "Existing ops access";
  const toPreset = to ? findPreset(after, to.presetId)?.name ?? to.presetId : "Existing ops access";
  if ((from?.presetId ?? "existing") !== (to?.presetId ?? "existing")) lines.push(`Started from ${toPreset} (was ${fromPreset})`);
  lines.push(...levelChanges(resolveAccessLevels(before, userId), resolveAccessLevels(after, userId)));
  lines.push(...switchChanges(from?.capabilities, to?.capabilities));
  lines.push(...sensitiveChanges(from?.sensitive, to?.sensitive));
  return lines;
}

function presetChanges(before: OpsPolicy, after: OpsPolicy): AccessChange[] {
  const ids = new Set([...before.presets.map((preset) => preset.id), ...after.presets.map((preset) => preset.id)]);
  return Array.from(ids).flatMap((id) => {
    const from = before.presets.find((preset) => preset.id === id);
    const to = after.presets.find((preset) => preset.id === id);
    const name = to?.name ?? from?.name ?? id;
    const subject = { kind: "preset" as const, id, name };
    if (!from) return [{ subject, text: `Preset created: ${name}` }];
    if (!to) return [{ subject, text: `Preset removed: ${name}` }];
    const lines: string[] = [];
    if (from.name !== to.name) lines.push(`Renamed from ${from.name}`);
    if (from.description !== to.description) lines.push("Description changed");
    if ((from.audience ?? "manager") !== (to.audience ?? "manager")) lines.push(to.audience === "assistant" ? "Now an office assistant preset" : "Now an operations manager preset");
    const asLevels = (levels: Partial<Record<string, AccessLevel>>) => Object.fromEntries(OPS_FEATURES.map((feature) => [feature.key, levels[feature.key] ?? "off"])) as Record<string, AccessLevel>;
    lines.push(...levelChanges(asLevels(from.levels), asLevels(to.levels)));
    lines.push(...switchChanges(from.capabilities, to.capabilities));
    lines.push(...sensitiveChanges(from.sensitive, to.sensitive));
    return lines.map((text) => ({ subject, text }));
  });
}

/** Every change between two policies, people first, then presets. */
export function policyChanges(before: OpsPolicy, after: OpsPolicy): AccessChange[] {
  const people = new Set([...Object.keys(before.assignments), ...Object.keys(after.assignments)]);
  const personLines = Array.from(people).flatMap((id) =>
    personChanges(before, after, id).map((text) => ({ subject: { kind: "person" as const, id }, text })),
  );
  return [...personLines, ...presetChanges(before, after)];
}

/**
 * Does this change touch the actor's own access? Their assignment, or the
 * custom preset their assignment uses. Nobody may change their own access.
 */
export function touchesOwnAccess(before: OpsPolicy, after: OpsPolicy, actorId: string): boolean {
  if (JSON.stringify(before.assignments[actorId] ?? null) !== JSON.stringify(after.assignments[actorId] ?? null)) return true;
  const presetId = after.assignments[actorId]?.presetId ?? before.assignments[actorId]?.presetId;
  if (!presetId) return false;
  const from = before.presets.find((preset) => preset.id === presetId);
  const to = after.presets.find((preset) => preset.id === presetId);
  return JSON.stringify(from ?? null) !== JSON.stringify(to ?? null);
}
