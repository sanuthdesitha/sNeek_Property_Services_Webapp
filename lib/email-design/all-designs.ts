/**
 * Every email design: the hand-written catalogue (registry.ts) and every
 * wording-layer email part (wording-designs.ts). Plain module. The shared
 * template bridge (lib/email-templates.ts) reads only registry.ts, so the
 * wording definitions never import back into themselves.
 */
import { EMAIL_DESIGNS } from "./registry";
import { wordingEmailDesigns } from "./wording-designs";
import { financeDesigns } from "./catalog/finance";
import type { EmailDesignDefinition } from "./types";

let all: EmailDesignDefinition[] | null = null;
let byKey: Map<string, EmailDesignDefinition> | null = null;

export function allEmailDesigns(): EmailDesignDefinition[] {
  if (!all) all = [...EMAIL_DESIGNS, ...wordingEmailDesigns(), ...financeDesigns()];
  return all;
}

export function findEmailDesign(key: string): EmailDesignDefinition | null {
  if (!byKey) byKey = new Map(allEmailDesigns().map((definition) => [definition.key, definition]));
  return byKey.get(key) ?? null;
}

export function allDesignsForType(typeKey: string): EmailDesignDefinition[] {
  return allEmailDesigns().filter((definition) => definition.typeKey === typeKey);
}
