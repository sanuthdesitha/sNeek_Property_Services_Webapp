/**
 * The wording registry: one definition per catalog type (status, parts and
 * default wording per transport). `tests/lib/notification-wording.test.ts`
 * fails when a catalog type has no definition, so a new type cannot ship
 * without saying whether its wording is editable. Plain module.
 */
import { NOTIFICATION_CATALOG } from "../catalog";
import { ACTION_WORDING } from "./definitions/actions";
import { JOB_WORDING } from "./definitions/jobs";
import { OFFICE_WORDING } from "./definitions/office";
import { ONBOARDING_WORDING } from "./definitions/onboarding";
import { PEOPLE_WORDING } from "./definitions/people";
import type { TypeWordingDefinition, WordingPartDefinition, WordingTransport } from "./types";

export const WORDING_DEFINITIONS: readonly TypeWordingDefinition[] = [...JOB_WORDING, ...OFFICE_WORDING, ...PEOPLE_WORDING, ...ACTION_WORDING, ...ONBOARDING_WORDING];

const BY_TYPE = new Map(WORDING_DEFINITIONS.map((definition) => [definition.typeKey, definition]));

/** Every catalog type's definition; a type without one reads as "In code" (never as editable). */
export function wordingDefinition(typeKey: string): TypeWordingDefinition | undefined {
  const found = BY_TYPE.get(typeKey);
  if (found) return found;
  if (!NOTIFICATION_CATALOG.some((entry) => entry.key === typeKey)) return undefined;
  return { typeKey, status: "IN_CODE", parts: [], reason: "No wording definition yet." };
}

export function wordingPart(typeKey: string, partId: string, transport: WordingTransport): WordingPartDefinition | undefined {
  return BY_TYPE.get(typeKey)?.parts.find((part) => part.id === partId && part.transport === transport);
}

/** Store-backed types only (the email-template parts keep their own store). */
export function hasStoreParts(typeKey: string): boolean {
  return (BY_TYPE.get(typeKey)?.parts ?? []).some((part) => part.source.kind === "STORE");
}
