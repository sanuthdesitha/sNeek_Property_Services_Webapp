/** Small builders for wording definitions. Plain module. */
import { EMAIL_TEMPLATE_DEFINITIONS, type AppEmailTemplateKey } from "@/lib/email-templates";
import type { TypeWordingDefinition, WordingField, WordingFields, WordingPartDefinition, WordingTransport } from "../types";

type StoreOptions = { push?: "SHARED"; note?: string; fields?: readonly WordingField[] };

/** A part kept in the wording override store. */
export function storePart(
  id: string,
  label: string,
  transport: WordingTransport,
  defaults: WordingFields,
  variables: readonly string[],
  required: readonly string[],
  options: StoreOptions = {},
): WordingPartDefinition {
  return { id, label, transport, defaults, variables, required, source: { kind: "STORE" }, ...options };
}

/** A fixed sentence added only when its condition holds (body only). */
export function linePart(id: string, label: string, transport: WordingTransport, body: string, variables: readonly string[], note: string): WordingPartDefinition {
  return storePart(id, label, transport, { body }, variables, [], { fields: ["body"], note });
}

/**
 * An email part backed by the existing shared email template. Its defaults
 * are resolved at read time from the template store (they may already carry
 * an edit made in Forms), so `defaults` stays empty here.
 */
export function emailTemplatePart(id: string, label: string, key: AppEmailTemplateKey, required: readonly string[] = [], note?: string): WordingPartDefinition {
  // Read lazily: modules (and tests) that never render this part need not load the template catalog.
  return {
    id,
    label,
    transport: "EMAIL",
    defaults: {},
    get variables() {
      return EMAIL_TEMPLATE_DEFINITIONS[key]?.variables ?? [];
    },
    required,
    source: { kind: "EMAIL_TEMPLATE", key },
    get note() {
      return note ?? `Shared email template "${EMAIL_TEMPLATE_DEFINITIONS[key]?.label ?? key}" (also listed in Forms, Messages).`;
    },
  };
}

export function editable(typeKey: string, parts: readonly WordingPartDefinition[], reason?: string): TypeWordingDefinition {
  return { typeKey, status: "EDITABLE", parts, ...(reason ? { reason } : {}) };
}

export function someParts(typeKey: string, parts: readonly WordingPartDefinition[], reason: string): TypeWordingDefinition {
  return { typeKey, status: "PARTS", parts, reason };
}

export function inCode(typeKey: string, reason: string): TypeWordingDefinition {
  return { typeKey, status: "IN_CODE", parts: [], reason };
}

export function composed(typeKey: string, reason: string, href?: string): TypeWordingDefinition {
  return { typeKey, status: "COMPOSED", parts: [], reason, ...(href ? { href } : {}) };
}

export function elsewhere(typeKey: string, reason: string, href: string): TypeWordingDefinition {
  return { typeKey, status: "ELSEWHERE", parts: [], reason, href };
}
