/**
 * Moving an assistant between teams of the SAME client (owner decision
 * 2026-11-13). Pure: what the move would change for the person, shown in the
 * dialog ("Loses: …  Gains: …") and recorded in the audit row, and the
 * reasons a move is refused. The server (`lib/va/move-member.ts`) re-checks
 * every rule inside its transaction.
 */
import { VA_PERMISSION_KEYS, VA_PERMISSION_LABELS, type VaPermissions } from "./permissions";

export type MoveTeamFacts = {
  id: string;
  name: string;
  clientId: string;
  isActive: boolean;
  permissions: VaPermissions;
  /** Null = every property of the client. */
  propertyIds: string[] | null;
};

export type MoveAccessChange = {
  loses: string[];
  gains: string[];
  /** Plain sentence for the property scope change, or null when unchanged. */
  scope: string | null;
};

export type MoveRefusalCode = "SAME_TEAM" | "CROSS_CLIENT" | "DESTINATION_INACTIVE";

export const MOVE_REFUSAL_TEXT: Record<MoveRefusalCode, string> = {
  SAME_TEAM: "The assistant is already on that team.",
  CROSS_CLIENT: "Assistants can only move between teams of the same client. Invite a new login for the other client instead.",
  DESTINATION_INACTIVE: "That team is switched off: the assistant could not act until it is switched on. Confirm to move them anyway.",
};

/** Why this move is refused, or null. An inactive destination is refused unless confirmed. */
export function moveRefusal(from: MoveTeamFacts, to: MoveTeamFacts, confirmInactive: boolean): MoveRefusalCode | null {
  if (from.id === to.id) return "SAME_TEAM";
  if (from.clientId !== to.clientId) return "CROSS_CLIENT";
  if (!to.isActive && !confirmInactive) return "DESTINATION_INACTIVE";
  return null;
}

function scopeLabel(ids: string[] | null, names: ReadonlyMap<string, string>): string {
  if (ids === null) return "every property of the client";
  if (ids.length === 0) return "no properties";
  return ids.map((id) => names.get(id) ?? "a removed property").join(", ");
}

/**
 * What changes for the person: permissions only on the old team are lost,
 * only on the new team are gained; the property scope sentence names both.
 */
export function moveAccessChange(from: MoveTeamFacts, to: MoveTeamFacts, propertyNames: ReadonlyMap<string, string>): MoveAccessChange {
  const loses: string[] = [];
  const gains: string[] = [];
  for (const key of VA_PERMISSION_KEYS) {
    if (from.permissions[key] && !to.permissions[key]) loses.push(VA_PERMISSION_LABELS[key].title);
    if (!from.permissions[key] && to.permissions[key]) gains.push(VA_PERMISSION_LABELS[key].title);
  }
  const sameScope =
    (from.propertyIds === null && to.propertyIds === null) ||
    (from.propertyIds !== null && to.propertyIds !== null && [...from.propertyIds].sort().join("|") === [...to.propertyIds].sort().join("|"));
  const scope = sameScope ? null : `Properties: from ${scopeLabel(from.propertyIds, propertyNames)} to ${scopeLabel(to.propertyIds, propertyNames)}.`;
  if (!to.isActive) loses.push("Everything until the team is switched on");
  return { loses, gains, scope };
}
