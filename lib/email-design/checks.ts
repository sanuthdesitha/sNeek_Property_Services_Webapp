/**
 * Validation of an email document: reading untrusted input into a valid
 * document, and the "Checks before publishing" list. Errors block publishing;
 * notes do not. Plain module (the editor shows the same list the server
 * enforces).
 */
import { inlineKey, inlineLength, inlineValues, isInlineEmpty, parseInline } from "./inline";
import { formatRatio, themeContrastReport } from "./theme";
import {
  CALLOUT_TONES,
  EMAIL_BLOCK_TYPES,
  type CalloutTone,
  type DetailsRow,
  type EmailBlock,
  type EmailBlockType,
  type EmailDesignDefinition,
  type EmailDocument,
  type EmailTheme,
  type Inline,
} from "./types";

export const SUBJECT_LIMIT = 50;
export const PREHEADER_LIMIT = 90;
export const HEADING_LIMIT = 60;
export const BUTTON_LABEL_LIMIT = 24;
export const NOTE_LIMIT = 200;
export const MAX_BLOCKS = 30;

export type DesignCheck = { id: string; level: "error" | "note"; ok: boolean; message: string };

const ID = /^[a-zA-Z0-9_-]{1,40}$/;
const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, limit) : "";
}

function parseRows(value: unknown): DetailsRow[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item, index): DetailsRow[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    return [{ id: typeof row.id === "string" && ID.test(row.id) ? row.id : `r${index + 1}`, label: text(row.label, 60), value: parseInline(row.value) }];
  });
}

function parseBlock(value: unknown, index: number): EmailBlock | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const type = row.type as EmailBlockType;
  if (!EMAIL_BLOCK_TYPES.includes(type)) return null;
  const lock: "fixed" | "required" | undefined = row.lock === "fixed" || row.lock === "required" ? row.lock : undefined;
  const base: { id: string; showIf?: string; lock?: "fixed" | "required" } = {
    id: typeof row.id === "string" && ID.test(row.id) ? row.id : `n${index + 1}`,
    ...(typeof row.showIf === "string" && NAME.test(row.showIf) ? { showIf: row.showIf } : {}),
    ...(lock ? { lock } : {}),
  };
  const source = typeof row.source === "string" && NAME.test(row.source) ? row.source : "";
  switch (type) {
    case "heading":
    case "paragraph":
    case "note":
      return { ...base, type, text: parseInline(row.text) };
    case "details":
      return { ...base, type, rows: parseRows(row.rows) };
    case "lineItems":
    case "code":
      return source ? { ...base, type, source } : null;
    case "photos":
      return source ? { ...base, type, source, caption: parseInline(row.caption) } : null;
    case "button": {
      const link = typeof row.link === "string" && NAME.test(row.link) ? row.link : "";
      if (!link) return null;
      const labelValue = typeof row.labelValue === "string" && NAME.test(row.labelValue) ? row.labelValue : undefined;
      return { ...base, type, label: text(row.label, 60), link, ...(labelValue ? { labelValue } : {}) };
    }
    case "callout": {
      const tone = CALLOUT_TONES.includes(row.tone as CalloutTone) ? (row.tone as CalloutTone) : "note";
      return { ...base, type, tone, text: parseInline(row.text) };
    }
    case "signature":
      return { ...base, type, name: parseInline(row.name), role: parseInline(row.role) };
    case "divider":
      return { ...base, type };
  }
}

/** Untrusted input → a document (unknown blocks and malformed parts dropped). */
export function parseDocument(value: unknown): EmailDocument | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.blocks)) return null;
  const blocks = row.blocks.slice(0, MAX_BLOCKS).flatMap((item, index) => {
    const block = parseBlock(item, index);
    return block ? [block] : [];
  });
  const reference = typeof row.reference === "string" && NAME.test(row.reference) ? row.reference : undefined;
  return { subject: parseInline(row.subject), preheader: parseInline(row.preheader), ...(reference ? { reference } : {}), blocks };
}

/** Values a block or the subject uses, in order. */
export function documentValues(doc: EmailDocument): string[] {
  const names = new Set<string>([...inlineValues(doc.subject), ...inlineValues(doc.preheader)]);
  if (doc.reference) names.add(doc.reference);
  for (const block of doc.blocks) {
    if (block.showIf) names.add(block.showIf);
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "note":
      case "callout":
        inlineValues(block.text).forEach((name) => names.add(name));
        break;
      case "details":
        block.rows.forEach((item) => inlineValues(item.value).forEach((name) => names.add(name)));
        break;
      case "lineItems":
      case "code":
        names.add(block.source);
        break;
      case "photos":
        names.add(block.source);
        inlineValues(block.caption).forEach((name) => names.add(name));
        break;
      case "button":
        names.add(block.link);
        if (block.labelValue) names.add(block.labelValue);
        break;
      case "signature":
        inlineValues(block.name).forEach((name) => names.add(name));
        inlineValues(block.role).forEach((name) => names.add(name));
        break;
      case "divider":
        break;
    }
  }
  return Array.from(names);
}

function blockKey(block: EmailBlock): string {
  const parts: string[] = [block.type, block.showIf ?? "", block.lock ?? ""];
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "note":
      parts.push(inlineKey(block.text));
      break;
    case "callout":
      parts.push(block.tone, inlineKey(block.text));
      break;
    case "details":
      parts.push(block.rows.map((item) => `${item.label}=${inlineKey(item.value)}`).join(";"));
      break;
    case "lineItems":
    case "code":
      parts.push(block.source);
      break;
    case "photos":
      parts.push(block.source, inlineKey(block.caption));
      break;
    case "button":
      parts.push(block.label, block.link, block.labelValue ?? "");
      break;
    case "signature":
      parts.push(inlineKey(block.name), inlineKey(block.role));
      break;
    case "divider":
      break;
  }
  return parts.join("§");
}

/** A stable fingerprint of a document (comparing drafts, versions and the standard). */
export function documentKey(doc: EmailDocument): string {
  return [inlineKey(doc.subject), inlineKey(doc.preheader), doc.reference ?? "", ...doc.blocks.map((block) => `${block.id}#${blockKey(block)}`)].join("\n");
}

function blockEmptyMessage(block: EmailBlock): string | null {
  const label = block.type === "note" ? "Secondary note" : block.type === "callout" ? "Callout" : block.type === "paragraph" ? "Paragraph" : block.type === "heading" ? "Heading" : null;
  if (!label) return null;
  if ((block.type === "heading" || block.type === "paragraph" || block.type === "note" || block.type === "callout") && isInlineEmpty(block.text)) {
    return `${label} is empty. Write ${block.type === "heading" ? "a heading" : block.type === "note" ? "a note" : "the words"} or remove the block.`;
  }
  return null;
}

/** Text length with each value counted at its sample length. */
function measured(definition: EmailDesignDefinition, value: Inline): number {
  const samples = new Map(definition.variables.map((variable) => [variable.name, variable.sample.length || 10]));
  return inlineLength(value, (name) => samples.get(name) ?? 10);
}

/**
 * The checks list. `theme` adds the contrast check. Errors block saving a
 * version for publishing; notes are advice.
 */
export function checkDocument(definition: EmailDesignDefinition, doc: EmailDocument, theme?: EmailTheme): DesignCheck[] {
  const checks: DesignCheck[] = [];
  const allowed = new Set(definition.variables.map((variable) => variable.name));
  const used = documentValues(doc);
  const subjectLength = measured(definition, doc.subject);
  checks.push(isInlineEmpty(doc.subject)
    ? { id: "subject", level: "error", ok: false, message: "Write a subject." }
    : { id: "subject", level: "note", ok: subjectLength <= SUBJECT_LIMIT, message: `Subject ${subjectLength} of ${SUBJECT_LIMIT} characters with sample values${subjectLength > SUBJECT_LIMIT ? "; long subjects are cut off on phones" : ""}.` });
  const preheaderLength = measured(definition, doc.preheader);
  checks.push({ id: "preheader", level: "note", ok: preheaderLength <= PREHEADER_LIMIT, message: `Preheader ${preheaderLength} of ${PREHEADER_LIMIT} characters.` });

  const unknown = used.filter((name) => !allowed.has(name));
  checks.push({ id: "unknown-values", level: "error", ok: unknown.length === 0, message: unknown.length ? `Not a value this email can use: ${unknown.join(", ")}.` : "Every inserted value is allowed for this email." });

  const keep = definition.variables.filter((variable) => (variable.keep || variable.required) && definition.defaults && documentValues(definition.defaults).includes(variable.name));
  const dropped = keep.filter((variable) => !used.includes(variable.name));
  const keepLabels = keep.map((variable) => variable.label);
  checks.push({ id: "required-values", level: "error", ok: dropped.length === 0, message: dropped.length ? `Required values removed: ${dropped.map((variable) => variable.label).join(", ")}. Put them back.` : keepLabels.length ? `Required values present: ${keepLabels.join(", ")}.` : "No required values for this email." });

  const buttons = doc.blocks.filter((block) => block.type === "button");
  const urlNames = new Set(definition.variables.filter((variable) => variable.format === "url").map((variable) => variable.name));
  const badLink = buttons.find((block) => block.type === "button" && !urlNames.has(block.link));
  checks.push({ id: "button", level: "error", ok: buttons.length <= 1 && !badLink, message: buttons.length > 1 ? "Only one button per email; other links are plain text." : badLink ? "The button's link must be a link this email type provides." : buttons.length ? "One button, with a link set by the type." : "No button." });
  const longLabel = buttons.find((block) => block.type === "button" && block.label.length > BUTTON_LABEL_LIMIT);
  if (longLabel) checks.push({ id: "button-label", level: "note", ok: false, message: `Button label is over ${BUTTON_LABEL_LIMIT} characters.` });

  const defaults = new Map(definition.defaults.blocks.map((block) => [block.id, block]));
  const allowedTypes = new Set<EmailBlockType>(definition.allowedBlocks);
  const notAllowed = doc.blocks.filter((block) => !allowedTypes.has(block.type) && !(defaults.get(block.id)?.type === block.type));
  checks.push({ id: "blocks-allowed", level: "error", ok: notAllowed.length === 0, message: notAllowed.length ? `This email type does not allow: ${Array.from(new Set(notAllowed.map((block) => block.type))).join(", ")}.` : "Only blocks this email type allows." });

  const lockedDefaults = definition.defaults.blocks.filter((block) => block.lock);
  const docById = new Map(doc.blocks.map((block) => [block.id, block]));
  const missingLocked = lockedDefaults.filter((block) => !docById.has(block.id));
  const changedFixed = lockedDefaults.filter((block) => block.lock === "fixed" && docById.has(block.id) && blockKey(docById.get(block.id) as EmailBlock) !== blockKey(block));
  const orderChanged = definition.security && doc.blocks.map((block) => block.id).join(",") !== definition.defaults.blocks.map((block) => block.id).join(",");
  checks.push({ id: "locked", level: "error", ok: missingLocked.length === 0 && changedFixed.length === 0 && !orderChanged, message: missingLocked.length ? "A locked block was removed. Put it back or reset to standard." : changedFixed.length || orderChanged ? "Fixed security content was changed. Security emails keep their words fixed." : lockedDefaults.length ? "Locked content present." : "No locked content." });
  if (definition.security) {
    const same = documentKey(doc) === documentKey(definition.defaults);
    checks.push({ id: "security-fixed", level: "error", ok: same, message: same ? "Security email: words fixed, only the theme applies." : "Security emails keep their words fixed. Reset to standard." });
  }

  const first = doc.blocks[0];
  checks.push({ id: "title", level: definition.titleOptional ? "note" : "error", ok: first?.type === "heading", message: first?.type === "heading" ? "The title is the first block." : definition.titleOptional ? "No title block (this email never had one). Adding a heading first is recommended." : "The first block must be the heading (the title)." });
  if (first?.type === "heading" && measured(definition, first.text) > HEADING_LIMIT) checks.push({ id: "title-length", level: "note", ok: false, message: `The title is over ${HEADING_LIMIT} characters.` });

  for (const block of doc.blocks) {
    const empty = blockEmptyMessage(block);
    if (empty && !block.showIf) checks.push({ id: `empty-${block.id}`, level: "error", ok: false, message: empty });
    if (block.type === "note" && measured(definition, block.text) > NOTE_LIMIT) checks.push({ id: `long-${block.id}`, level: "note", ok: false, message: `A secondary note is over ${NOTE_LIMIT} characters.` });
    if (block.type === "details" && block.rows.some((item) => !item.label.trim())) checks.push({ id: `label-${block.id}`, level: "error", ok: false, message: "A details row has no label." });
  }
  if (doc.blocks.length > MAX_BLOCKS) checks.push({ id: "too-many", level: "error", ok: false, message: `At most ${MAX_BLOCKS} blocks.` });

  if (theme) {
    const report = themeContrastReport(theme);
    const failing = report.filter((item) => !item.ok);
    checks.push({ id: "contrast", level: "error", ok: failing.length === 0, message: failing.length ? `Contrast too low: ${failing.map((item) => `${item.label} ${formatRatio(Math.min(item.light, item.dark))}`).join(", ")}.` : "Contrast passes in light and dark." });
  }
  checks.push({ id: "footer", level: "note", ok: true, message: definition.security ? "Footer and business details present (fixed); security emails have no preferences link." : "Footer, why-line and preferences link present (fixed)." });
  return checks;
}

export function blockingChecks(checks: DesignCheck[]): DesignCheck[] {
  return checks.filter((check) => check.level === "error" && !check.ok);
}
