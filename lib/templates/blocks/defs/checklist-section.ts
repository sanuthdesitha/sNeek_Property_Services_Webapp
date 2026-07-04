/**
 * checklistSection block — renders inspection/quote checklist sections for the
 * document channel (pdf + web). Each section groups titled items with a
 * pass/fail/na status glyph, optional value, note, and media thumbnails.
 *
 * Marketing mode ("what's covered / not covered") suppresses notes and media
 * and mutes excluded (unchecked) items for the quote-facing view.
 */

import { z } from "zod";
import { getPath } from "../../model";
import type { BlockDefinition, BlockRenderCtx } from "../types";

// ---------------------------------------------------------------------------
// Local escape helper (mirrors registry.ts — intentionally not shared)
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const checklistSectionProps = z.object({
  /** Data path of the sections array to bind, e.g. "report.sections". */
  bind: z.string().default(""),
  mode: z.enum(["full", "marketing"]).default("full"),
  showMedia: z.boolean().default(true),
  emptyText: z.string().default("No sections."),
});

// Shape of the bound data (loose — comes from arbitrary render data contexts).
interface ChecklistMedia {
  url: string;
  type?: "PHOTO" | "VIDEO";
  caption?: string;
}
interface ChecklistItem {
  label: string;
  checked?: boolean;
  value?: string;
  note?: string;
  media?: ChecklistMedia[];
}
interface ChecklistSection {
  title: string;
  items: ChecklistItem[];
}

function renderGlyph(checked: boolean | undefined): string {
  if (checked === true) return `<span class="tpl-check tpl-check-pass">✓</span>`;
  if (checked === false) return `<span class="tpl-check tpl-check-fail">✗</span>`;
  return `<span class="tpl-check tpl-check-na">•</span>`;
}

function renderMedia(item: ChecklistItem): string {
  const media = Array.isArray(item.media) ? item.media.slice(0, 6) : [];
  if (media.length === 0) return "";
  const thumbs = media
    .map((m) => {
      if (m.type === "VIDEO") {
        return `<span class="tpl-item-thumb tpl-item-video">▶ ${esc(m.caption ?? "Video")}</span>`;
      }
      return `<img class="tpl-item-thumb" src="${esc(m.url ?? "")}" alt="${esc(m.caption ?? "")}" />`;
    })
    .join("");
  return `<div class="tpl-item-media">${thumbs}</div>`;
}

function renderItem(item: ChecklistItem, props: z.infer<typeof checklistSectionProps>): string {
  const marketing = props.mode === "marketing";
  const excluded = marketing && item.checked === false;

  // In marketing mode, excluded items render muted with an em-dash glyph.
  const glyph = excluded
    ? `<span class="tpl-check tpl-check-na">—</span>`
    : renderGlyph(item.checked);

  const label = `<span class="tpl-item-label">${esc(item.label ?? "")}</span>`;
  const value = item.value ? `<span class="tpl-item-value">${esc(item.value)}</span>` : "";

  const note = item.note && !marketing ? `<p class="tpl-item-note">${esc(item.note)}</p>` : "";
  const media = props.showMedia && !marketing ? renderMedia(item) : "";

  const cls = excluded ? "tpl-checklist-item tpl-item-excluded" : "tpl-checklist-item";
  return `<div class="${cls}">${glyph}${label}${value}${note}${media}</div>`;
}

function renderSection(
  section: ChecklistSection,
  props: z.infer<typeof checklistSectionProps>,
): string {
  const items = Array.isArray(section.items) ? section.items : [];
  const itemHtml = items.map((item) => renderItem(item, props)).join("");
  return `<div class="tpl-checklist-section"><p class="tpl-checklist-title">${esc(section.title ?? "")}</p>${itemHtml}</div>`;
}

export const checklistSectionBlock: BlockDefinition<z.infer<typeof checklistSectionProps>> = {
  type: "checklistSection",
  label: "Checklist section",
  channels: ["pdf", "web"],
  propsSchema: checklistSectionProps,
  defaults: () => checklistSectionProps.parse({}),
  renderDocument(props: z.infer<typeof checklistSectionProps>, ctx: BlockRenderCtx) {
    const bound = getPath(ctx.data, props.bind);
    const sections = Array.isArray(bound) ? (bound as ChecklistSection[]) : [];
    if (sections.length === 0) {
      return `<p class="tpl-empty">${esc(props.emptyText)}</p>`;
    }
    const body = sections.map((section) => renderSection(section, props)).join("");
    return `<section class="tpl-checklist">${body}</section>`;
  },
};
