/** Small builders for wording definitions. Plain module. */
import { EMAIL_TEMPLATE_DEFINITIONS, type AppEmailTemplateKey } from "@/lib/email-templates";
import { NOTIFICATION_TEMPLATE_DEFINITIONS, type AppNotificationTemplateKey } from "@/lib/notification-templates";
import type { TypeWordingDefinition, WordingField, WordingFields, WordingPartDefinition, WordingTransport } from "../types";
import { templateVariables } from "../template";

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
      return note ?? `Shared email template "${EMAIL_TEMPLATE_DEFINITIONS[key]?.label ?? key}": now an email design on the block layout. Edit its words, blocks and preview in "Email design" under this type's details; raw HTML is not saved here (Reset still puts the standard back).`;
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

type AutoOptions = { required?: readonly string[]; push?: "SHARED"; note?: string; extra?: readonly string[] };

/** Variables used by a set of default fields, in order of first use. */
function usedVariables(defaults: WordingFields): string[] {
  return Array.from(new Set([defaults.title, defaults.subject, defaults.body].flatMap((text) => (text ? templateVariables(text) : []))));
}

/**
 * A store part whose variables are exactly the ones its default wording uses
 * (plus `extra`). Required defaults to every variable that carries a fact a
 * recipient cannot work out (callers narrow it where a value is optional).
 */
export function part(id: string, label: string, transport: WordingTransport, defaults: WordingFields, options: AutoOptions = {}): WordingPartDefinition {
  const variables = Array.from(new Set([...usedVariables(defaults), ...(options.extra ?? [])]));
  return storePart(id, label, transport, defaults, variables, options.required ?? [], { push: options.push, note: options.note });
}

/** An inbox part whose text is also the phone push (the usual inbox row). */
export function inbox(id: string, label: string, title: string, body: string, options: AutoOptions = {}): WordingPartDefinition {
  return part(id, label, "INBOX", { title, body }, { push: "SHARED", ...options });
}

/** A line part whose variables are the ones its sentence uses. */
export function line(id: string, label: string, transport: WordingTransport, body: string, note: string): WordingPartDefinition {
  return linePart(id, label, transport, body, templateVariables(body), note);
}

/**
 * The INBOX (title, body; also the phone push) and SMS parts backed by the
 * existing shared in-app / SMS template `settings.notificationTemplates[key]`.
 */
export function notificationTemplateParts(id: string, label: string, key: AppNotificationTemplateKey, required: readonly string[] = []): WordingPartDefinition[] {
  const make = (transport: "INBOX" | "SMS"): WordingPartDefinition => ({
    id,
    label,
    transport,
    defaults: {},
    get variables() {
      return NOTIFICATION_TEMPLATE_DEFINITIONS[key]?.variables ?? [];
    },
    required,
    source: { kind: "NOTIFICATION_TEMPLATE", key },
    ...(transport === "INBOX" ? { push: "SHARED" as const } : {}),
    get note() {
      return `Shared notification template "${NOTIFICATION_TEMPLATE_DEFINITIONS[key]?.label ?? key}" (also listed in Forms, Messages).`;
    },
  });
  return [make("INBOX"), make("SMS")];
}
