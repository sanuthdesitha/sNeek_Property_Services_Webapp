/**
 * Inline text helpers. Plain module.
 *
 * `inline()` is for wording written in CODE (the version-1 defaults): it reads
 * `{{name}}` as a value chip and `**words**` as bold. Text an editor types is
 * never parsed: the editor stores segments directly, so a typed "{{" or "<"
 * stays plain text.
 */
import type { Inline, InlineSegment } from "./types";

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function pushText(out: Inline, text: string, bold: boolean): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === "text" && Boolean(last.bold) === bold) {
    last.text += text;
    return;
  }
  out.push(bold ? { kind: "text", text, bold: true } : { kind: "text", text });
}

function parseRun(out: Inline, run: string, bold: boolean): void {
  let index = 0;
  const pattern = new RegExp(TOKEN.source, "g");
  let match: RegExpExecArray | null = pattern.exec(run);
  while (match) {
    pushText(out, run.slice(index, match.index), bold);
    out.push(bold ? { kind: "value", name: match[1], bold: true } : { kind: "value", name: match[1] });
    index = match.index + match[0].length;
    match = pattern.exec(run);
  }
  pushText(out, run.slice(index), bold);
}

/** Code-authored wording → segments. */
export function inline(source: string): Inline {
  const out: Inline = [];
  const parts = source.split("**");
  parts.forEach((part, position) => parseRun(out, part, position % 2 === 1));
  return out;
}

/** Value names used in a run of inline text, in order of first use. */
export function inlineValues(text: Inline | undefined): string[] {
  const names: string[] = [];
  for (const segment of text ?? []) {
    if (segment.kind === "value" && !names.includes(segment.name)) names.push(segment.name);
  }
  return names;
}

/** Plain characters, with each value shown by its name (for counting and comparing). */
export function inlineLength(text: Inline, valueLength: (name: string) => number = () => 12): number {
  return text.reduce((total, segment) => total + (segment.kind === "text" ? segment.text.length : valueLength(segment.name)), 0);
}

export function isInlineEmpty(text: Inline | undefined): boolean {
  return !(text ?? []).some((segment) => segment.kind === "value" || segment.text.trim() !== "");
}

/** A stable signature for comparing two runs of inline text. */
export function inlineKey(text: Inline): string {
  return text.map((segment) => (segment.kind === "text" ? `t${segment.bold ? "b" : ""}:${segment.text}` : `v${segment.bold ? "b" : ""}:${segment.name}`)).join("|");
}

/** Validates an unknown value as inline segments (malformed parts are dropped). */
export function parseInline(value: unknown): Inline {
  if (!Array.isArray(value)) return [];
  const out: Inline = [];
  for (const item of value.slice(0, 200)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.kind === "text" && typeof row.text === "string") {
      const segment: InlineSegment = row.bold === true ? { kind: "text", text: row.text.slice(0, 2000), bold: true } : { kind: "text", text: row.text.slice(0, 2000) };
      out.push(segment);
    } else if (row.kind === "value" && typeof row.name === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(row.name)) {
      out.push(row.bold === true ? { kind: "value", name: row.name, bold: true } : { kind: "value", name: row.name });
    }
  }
  return out;
}
