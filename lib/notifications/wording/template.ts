/**
 * The wording template language: plain {{variable}} substitution and nothing
 * else. No expressions, no helpers, no code: a template can never execute
 * anything. Plain module (client-safe): the editor uses the same checks the
 * server enforces.
 */
import { escapeHtml } from "@/lib/utils/escape-html";
import type { VariableFormat, WordingField, WordingFields, WordingTransport } from "./types";
import { TRANSPORT_FIELDS } from "./types";

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export type TemplateValues = Readonly<Record<string, string | number | null | undefined>>;

/** Variable names used by a template, in order of first use. */
export function templateVariables(text: string): string[] {
  const names: string[] = [];
  text.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (!names.includes(name)) names.push(name);
    return match;
  });
  return names;
}

function valueText(value: TemplateValues[string]): string {
  return value === null || value === undefined ? "" : String(value);
}

/** Plain-text rendering (inbox, push, SMS, email subject). Values are inserted as they are. */
export function renderPlain(text: string, values: TemplateValues): string {
  return text.replace(VARIABLE_PATTERN, (_, name: string) => valueText(values[name]));
}

/**
 * HTML rendering (email body). The template text is admin-authored HTML and
 * stays as written; every value is escaped, except "html" fragments this
 * codebase built and escaped itself.
 */
export function renderHtml(text: string, values: TemplateValues, formats: Readonly<Record<string, VariableFormat | undefined>>): string {
  return text.replace(VARIABLE_PATTERN, (_, name: string) => {
    const value = valueText(values[name]);
    const format = formats[name] ?? "text";
    if (format === "html") return value;
    if (format === "multiline") return escapeHtml(value).replace(/\n/g, "<br>");
    return escapeHtml(value);
  });
}

export const FIELD_MAX_LENGTH: Record<WordingTransport, Partial<Record<WordingField, number>>> = {
  INBOX: { title: 200, body: 2000 },
  PUSH: { title: 200, body: 2000 },
  EMAIL: { subject: 300, body: 20000 },
  SMS: { body: 1000 },
};

export type WordingProblem = { field: WordingField | null; code: "empty" | "too_long" | "unknown_variable" | "missing_required" | "broken_placeholder" | "unsafe_html"; message: string };

const UNSAFE_HTML = [/<\s*script/i, /<\s*iframe/i, /<\s*object/i, /<\s*embed/i, /\son[a-z]+\s*=/i, /javascript\s*:/i];

/**
 * Checks wording before it is saved, accepted from a proposal or rendered from
 * the store. Unknown variables and a missing required variable are refused;
 * so is a "{{" that is not a valid placeholder and script in an email body.
 */
export function checkWording(input: {
  transport: WordingTransport;
  fields: WordingFields;
  /** The part's fields (defaults to every field of the transport). */
  fieldNames?: readonly WordingField[];
  allowed: readonly string[];
  required: readonly string[];
}): WordingProblem[] {
  const problems: WordingProblem[] = [];
  const used = new Set<string>();
  for (const field of input.fieldNames ?? TRANSPORT_FIELDS[input.transport]) {
    const text = input.fields[field] ?? "";
    if (!text.trim()) {
      problems.push({ field, code: "empty", message: "This field cannot be empty." });
      continue;
    }
    const max = FIELD_MAX_LENGTH[input.transport][field] ?? 2000;
    if (text.length > max) problems.push({ field, code: "too_long", message: `Keep it under ${max} characters.` });
    const stripped = text.replace(VARIABLE_PATTERN, "");
    if (stripped.includes("{{") || stripped.includes("}}")) problems.push({ field, code: "broken_placeholder", message: "A variable is not written as {{name}}." });
    for (const name of templateVariables(text)) {
      used.add(name);
      if (!input.allowed.includes(name)) problems.push({ field, code: "unknown_variable", message: `{{${name}}} is not a variable of this notification.` });
    }
    if (input.transport === "EMAIL" && field === "body" && UNSAFE_HTML.some((pattern) => pattern.test(text))) {
      problems.push({ field, code: "unsafe_html", message: "Scripts, frames and event attributes are not allowed in an email." });
    }
  }
  for (const name of input.required) {
    if (!used.has(name)) problems.push({ field: null, code: "missing_required", message: `{{${name}}} is required and missing.` });
  }
  return problems;
}

/**
 * GSM 03.38 basic and extension characters. Anything else (an emoji, a curly
 * quote) switches the whole SMS to UCS-2: 70 characters per message.
 */
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export type SmsLength = { characters: number; segments: number; perSegment: number; unicode: boolean };

export function smsLength(text: string): SmsLength {
  const chars = Array.from(text);
  const unicode = chars.some((char) => !GSM_BASIC.includes(char) && !GSM_EXTENDED.includes(char));
  const characters = unicode ? chars.length : chars.reduce((total, char) => total + (GSM_EXTENDED.includes(char) ? 2 : 1), 0);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const segments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { characters, segments, perSegment: segments > 1 ? multi : single, unicode };
}

/** Stable short fingerprint of a part's live wording (the stale-write guard compares it). */
export function wordingHash(fields: WordingFields): string {
  const text = JSON.stringify([fields.title ?? null, fields.subject ?? null, fields.body ?? null]);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return `${text.length.toString(36)}-${hash.toString(36)}`;
}

/** The existing email templates use {name}; the editor shows {{name}}. Lossless both ways. */
export function fromEmailTemplateSyntax(text: string): string {
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string, offset: number, whole: string) => {
    const before = whole[offset - 1];
    const after = whole[offset + match.length];
    return before === "{" || after === "}" ? match : `{{${name}}}`;
  });
}

export function toEmailTemplateSyntax(text: string): string {
  return text.replace(VARIABLE_PATTERN, (_, name: string) => `{${name}}`);
}
