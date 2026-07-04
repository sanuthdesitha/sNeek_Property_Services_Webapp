/**
 * qaScoreCard block — a single-object QA verdict card (rebrand doc 03 §1.3).
 * Reads ONE object (not an array) at props.bind: verdict, score, category bars,
 * and an optional rework panel. Document-only (pdf + web).
 */

import { z } from "zod";
import { getPath } from "../../model";
import type { BlockDefinition, BlockRenderCtx } from "../types";

// ---------------------------------------------------------------------------
// Shared helpers (local copy — defs are self-contained, never import esc)
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bound a percentage into the 0..100 range for a bar width. */
function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// ---------------------------------------------------------------------------
// qaScoreCard
// ---------------------------------------------------------------------------

interface QaCategory {
  label: string;
  score: number;
}

interface QaRework {
  required?: boolean;
  severity?: string;
  areas?: string[];
  note?: string;
}

interface QaValue {
  score?: number | null;
  passed?: boolean | null;
  scoreLabel?: string;
  categories?: QaCategory[];
  rework?: QaRework | null;
}

const qaScoreCardProps = z.object({
  bind: z.string().default(""),
});

export const qaScoreCardBlock: BlockDefinition<z.infer<typeof qaScoreCardProps>> = {
  type: "qaScoreCard",
  label: "QA score card",
  channels: ["pdf", "web"],
  propsSchema: qaScoreCardProps,
  defaults: () => qaScoreCardProps.parse({}),
  renderDocument(props, _ctx: BlockRenderCtx) {
    const raw = getPath(_ctx.data, props.bind);
    if (raw == null || typeof raw !== "object") {
      return `<p class="tpl-empty">No QA data.</p>`;
    }
    const qa = raw as QaValue;

    // Verdict badge.
    let verdict: string;
    if (qa.passed === true) {
      verdict = `<span class="tpl-qa-verdict tpl-qa-pass">Passed</span>`;
    } else if (qa.passed === false) {
      verdict = `<span class="tpl-qa-verdict tpl-qa-fail">Failed</span>`;
    } else {
      verdict = `<span class="tpl-qa-verdict">Reviewed</span>`;
    }

    // Score numeral.
    const scoreNumeral =
      typeof qa.score === "number"
        ? `<span class="tpl-qa-score">${esc(qa.scoreLabel ?? `${Math.round(qa.score)}%`)}</span>`
        : "";

    const head = `<div class="tpl-qa-head">${verdict}${scoreNumeral}</div>`;

    // Categories.
    let cats = "";
    if (qa.categories?.length) {
      const rows = qa.categories
        .map(
          (cat) =>
            `<div class="tpl-qa-cat"><span class="tpl-qa-cat-label">${esc(cat.label)}</span><span class="tpl-qa-bar"><span class="tpl-qa-bar-fill" style="width:${clamp(cat.score)}%"></span></span><span class="tpl-qa-cat-score">${Math.round(cat.score)}%</span></div>`,
        )
        .join("");
      cats = `<div class="tpl-qa-cats">${rows}</div>`;
    }

    // Rework panel.
    let rework = "";
    if (qa.rework?.required) {
      const r = qa.rework;
      const sev = `<span class="tpl-qa-sev">${esc(r.severity ?? "Rework")}</span>`;
      const areas =
        r.areas && r.areas.length ? `<p>${esc(r.areas.join(", "))}</p>` : "";
      const note = r.note ? `<p>${esc(r.note)}</p>` : "";
      rework = `<div class="tpl-qa-rework">${sev}${areas}${note}</div>`;
    }

    return `<section class="tpl-qa-card">${head}${cats}${rework}</section>`;
  },
};
