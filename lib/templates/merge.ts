/**
 * Merge-field resolver (rebrand doc 03 §1.5).
 *
 * Canonical syntax: {{path.to.value}} with pipe formatters —
 *   {{invoice.total | money}}  {{job.scheduledDate | date:"EEE d MMM"}}
 * The resolver ALSO accepts legacy single-brace {var} during migration
 * (lib/email-templates.ts dialect); the importer rewrites, lint warns.
 *
 * Resolved values are HTML-escaped by default; the text channel (SMS) uses
 * resolveMergeText which leaves values raw.
 */

import { applyFormatter, type FormatterCtx } from "./formatters";
import { getPath } from "./model";

export interface MergeCtx extends FormatterCtx {
  data: unknown;
  /** Collects unresolved paths for publish-time linting; optional. */
  unresolved?: Set<string>;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// {{ path.to.value | formatter:"arg" }} — formatter chain of length 0..n
const DOUBLE_BRACE = /\{\{\s*([a-zA-Z0-9_.[\]]+)((?:\s*\|\s*[a-zA-Z]+(?::"[^"]*")?)*)\s*\}\}/g;
// Legacy {var} — single word only, so CSS braces / JSON in surrounding text stay safe.
const SINGLE_BRACE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
const PIPE_SEGMENT = /\|\s*([a-zA-Z]+)(?::"([^"]*)")?/g;

function resolveOne(path: string, pipes: string, ctx: MergeCtx): string {
  let value = getPath(ctx.data, path);
  if (value === undefined) ctx.unresolved?.add(path);

  let out: string | null = null;
  PIPE_SEGMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PIPE_SEGMENT.exec(pipes)) !== null) {
    const formatted = applyFormatter(match[1], out ?? value, match[2], ctx);
    out = formatted;
    value = formatted;
  }
  if (out !== null) return out;
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/** Resolve merge fields, HTML-escaping every substituted value. */
export function resolveMergeHtml(template: string, ctx: MergeCtx): string {
  const pass1 = template.replace(DOUBLE_BRACE, (_, path: string, pipes: string) =>
    escapeHtml(resolveOne(path, pipes ?? "", ctx)),
  );
  return pass1.replace(SINGLE_BRACE, (whole, name: string) => {
    const value = getPath(ctx.data, name);
    if (value === undefined) return whole; // leave untouched — not a known var
    return escapeHtml(resolveOne(name, "", ctx));
  });
}

/** Resolve merge fields with NO escaping — SMS / plain-text parts. */
export function resolveMergeText(template: string, ctx: MergeCtx): string {
  const pass1 = template.replace(DOUBLE_BRACE, (_, path: string, pipes: string) =>
    resolveOne(path, pipes ?? "", ctx),
  );
  return pass1.replace(SINGLE_BRACE, (whole, name: string) => {
    const value = getPath(ctx.data, name);
    if (value === undefined) return whole;
    return resolveOne(name, "", ctx);
  });
}

/** Lint helper: list merge paths referenced by a template string. */
export function listMergePaths(template: string): string[] {
  const paths = new Set<string>();
  let match: RegExpExecArray | null;
  DOUBLE_BRACE.lastIndex = 0;
  while ((match = DOUBLE_BRACE.exec(template)) !== null) paths.add(match[1]);
  return Array.from(paths);
}
