/**
 * Every wording-layer email part (lib/notifications/wording, transport EMAIL,
 * stored parts with a subject) as a block design. Version 1 is its default
 * HTML body converted to blocks once (convert-html.ts), with the same words
 * and values; an empty value stays empty, exactly as before. Its inbox, push
 * and SMS wording stay in the wording editor. Plain module.
 */
import { catalogEntry } from "@/lib/notifications/catalog";
import { audienceGroup, type AudienceGroup } from "@/lib/notifications/wording/audience-groups";
import { WORDING_DEFINITIONS } from "@/lib/notifications/wording/registry";
import { variableDefinition } from "@/lib/notifications/wording/variables";
import { partFields, type WordingPartDefinition } from "@/lib/notifications/wording/types";
import { GENERAL_BLOCKS, design, doc } from "./catalog/build";
import { convertHtmlBody } from "./convert-html";
import type { EmailDesignDefinition, EmailGroup, EmailValueFormat, EmailVariable, PreferencesTarget } from "./types";

export function wordingDesignKey(typeKey: string, partId: string): string {
  return `wording.${typeKey}.${partId}`;
}

/** A wording part that is a whole email (stored, with a subject); "line" parts stay sentences inside other emails. */
export function isWordingEmailPart(part: WordingPartDefinition): boolean {
  return part.transport === "EMAIL" && part.source.kind === "STORE" && partFields(part).includes("subject");
}

const GROUP: Record<AudienceGroup, { group: EmailGroup; why: string; preferences: PreferencesTarget }> = {
  Cleaners: { group: "cleaners", why: "You got this because you're on sNeek's team.", preferences: "cleaner" },
  Clients: { group: "clients", why: "You got this because you're a client of sNeek.", preferences: "client" },
  Guests: { group: "clients", why: "You got this because sNeek has a stay, item or enquiry linked to this address.", preferences: "none" },
  Laundry: { group: "laundry", why: "You got this because you handle laundry with sNeek.", preferences: "laundry" },
  Office: { group: "office", why: "You got this because you work in the sNeek office.", preferences: "staff" },
  Accounts: { group: "accounts", why: "You got this because of an account with sNeek.", preferences: "none" },
};

function formatOf(name: string): EmailValueFormat {
  const format = variableDefinition(name).format;
  return format === "html" ? "built" : format === "url" ? "url" : format === "multiline" ? "multiline" : "text";
}

function buildDesign(typeKey: string, part: WordingPartDefinition): EmailDesignDefinition {
  const entry = catalogEntry(typeKey);
  const audience = entry ? audienceGroup(entry) : "Office";
  const meta = GROUP[audience];
  const names = Array.from(new Set(part.variables));
  const variables: EmailVariable[] = names.map((name) => {
    const definition = variableDefinition(name);
    // Today an empty value renders as nothing, so it still does (fallback "").
    return { name, label: definition.label, sample: definition.sample, format: formatOf(name), fallback: "", ...(part.required.includes(name) ? { keep: true } : {}) };
  });
  const formats = Object.fromEntries(variables.map((variable) => [variable.name, variable.format]));
  const converted = convertHtmlBody(part.defaults.body ?? "", formats);
  for (const constant of converted.constants) variables.push({ name: constant.name, label: constant.label, sample: constant.url, format: "url", constant: constant.url, fallback: "" });
  // A sender that adds its own button around this email (wrapEmailHtml with an action) still gets it.
  const blocks = [...converted.blocks];
  if (!blocks.some((block) => block.type === "button") && !variables.some((variable) => variable.name === "actionUrl")) {
    variables.push({ name: "actionUrl", label: "Button link (from the sender)", sample: "", format: "url", fallback: "" }, { name: "actionLabel", label: "Button label (from the sender)", sample: "", fallback: "" });
    blocks.push({ type: "button", label: "Open", link: "actionUrl", labelValue: "actionLabel" });
  }
  const hasBuilt = variables.some((variable) => variable.format === "built");
  const security = typeKey === "account.security";
  return design({
    key: wordingDesignKey(typeKey, part.id),
    label: `${entry?.name ?? typeKey}: ${part.label}`,
    group: meta.group,
    typeKey,
    audience: part.label,
    trigger: entry?.trigger ?? "Sent by the notification it belongs to.",
    security,
    whyLine: meta.why,
    preferences: security ? "none" : meta.preferences,
    variables,
    allowedBlocks: hasBuilt ? [...GENERAL_BLOCKS, "lineItems"] : GENERAL_BLOCKS,
    mustStay: part.required.map((name) => variableDefinition(name).label),
    source: `wording ${typeKey} · ${part.label}`,
    titleOptional: !converted.hasTitle,
    wordingPart: { typeKey, partId: part.id },
    defaults: doc(part.defaults.subject ?? "", "", blocks),
  });
}

let cached: EmailDesignDefinition[] | null = null;

export function wordingEmailDesigns(): EmailDesignDefinition[] {
  if (!cached) {
    cached = WORDING_DEFINITIONS.flatMap((definition) => definition.parts.filter(isWordingEmailPart).map((part) => buildDesign(definition.typeKey, part)));
  }
  return cached;
}
