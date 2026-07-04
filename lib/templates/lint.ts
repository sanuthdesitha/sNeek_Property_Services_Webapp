/**
 * Publish lint (rebrand doc 03 §3.1) — runs before a draft can go live:
 *   - required blocks present for the kind
 *   - no unresolved merge paths when rendered against the kind's sample data
 *   - SMS segment budget (warning at >2 segments, error when empty)
 * Errors block publish; warnings don't.
 */

import type { BrandTokens } from "@/lib/brand/tokens";
import { getKindConfig } from "./kinds";
import type { TemplateDoc } from "./model";
import { renderDocumentHtml } from "./render/document";
import { renderEmail } from "./render/email";
import { renderText } from "./render/text";

export interface LintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function lintTemplateDoc(doc: TemplateDoc, brand: BrandTokens): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const config = getKindConfig(doc.kind);
  if (!config) {
    return { ok: false, errors: [`Unknown template kind "${doc.kind}"`], warnings };
  }

  // Required blocks
  const presentTypes = new Set(doc.blocks.map((block) => block.type));
  for (const required of config.requiredBlocks ?? []) {
    if (!presentTypes.has(required)) {
      errors.push(`Missing required block: ${required}`);
    }
  }

  // Disallowed blocks (kind scoping)
  for (const block of doc.blocks) {
    if (!config.allowedBlocks.includes(block.type)) {
      errors.push(`Block "${block.type}" is not allowed for ${doc.kind}`);
    }
  }

  // Render against sample data collecting unresolved merge paths
  const unresolved = new Set<string>();
  const sample = config.sampleData();
  try {
    if (config.family === "email") {
      renderEmail(doc, sample, brand, { unresolved });
    } else if (config.family === "document") {
      renderDocumentHtml(doc, sample, brand, "pdf", { unresolved });
    } else {
      const out = renderText(doc, sample, brand, { unresolved });
      if (!out.text.trim()) errors.push("SMS body is empty");
      if (out.segments > 2) warnings.push(`SMS is ${out.segments} segments (budget 2)`);
      if (out.encoding === "ucs2") warnings.push("SMS uses UCS-2 (emoji/special chars) — segments shrink to 70 chars");
    }
  } catch (err) {
    errors.push(`Render failed: ${err instanceof Error ? err.message : "unknown error"}`);
  }

  for (const path of Array.from(unresolved)) {
    errors.push(`Unknown variable: {{${path}}} — not in the ${doc.kind} data contract`);
  }

  if (doc.blocks.length === 0) errors.push("Template has no blocks");

  return { ok: errors.length === 0, errors, warnings };
}
