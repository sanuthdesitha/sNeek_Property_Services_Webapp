/**
 * photoGrid block — media gallery (rebrand doc 03 §1.3, documents wave).
 * Renders a bound array of photos/videos as a CSS-grid gallery for pdf/web and
 * a 2-column table of thumbnails for email. Central CSS supplies the grid layout
 * (tpl-photo-grid[data-cols]); this file only emits semantic markup.
 */

import { z } from "zod";
import { getPath } from "../../model";
import type { BlockDefinition, BlockRenderCtx } from "../types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Email-safe wrapper row: one full-width td with padding. */
function emailRow(inner: string, pad = "12px 32px"): string {
  return `<tr><td style="padding:${pad};">${inner}</td></tr>`;
}

// ---------------------------------------------------------------------------
// photoGrid
// ---------------------------------------------------------------------------

interface MediaItem {
  url: string;
  caption?: string;
  type?: "PHOTO" | "VIDEO";
  stamp?: string;
}

const photoGridProps = z.object({
  /** Data path of the media array to bind, e.g. "media". */
  bind: z.string().default(""),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
  max: z.number().int().min(1).max(60).default(12),
  showCaption: z.boolean().default(true),
  evidenceBadge: z.boolean().default(false),
  emptyText: z.string().default("No photos."),
});

export const photoGridBlock: BlockDefinition<z.infer<typeof photoGridProps>> = {
  type: "photoGrid",
  label: "Photo grid",
  channels: ["pdf", "web", "email"],
  propsSchema: photoGridProps,
  defaults: () => photoGridProps.parse({}),
  renderDocument(props, ctx) {
    const source = getPath(ctx.data, props.bind);
    const items: MediaItem[] = Array.isArray(source) ? (source as MediaItem[]) : [];
    if (items.length === 0) {
      return `<p class="tpl-empty">${esc(props.emptyText)}</p>`;
    }
    const shown = items.slice(0, props.max);
    const figures = shown
      .map((item) => {
        const media =
          item.type === "VIDEO"
            ? `<div class="tpl-photo-video">▶ ${esc(item.caption ?? "Video")}</div>`
            : `<img class="tpl-photo-img" src="${esc(item.url)}" alt="${esc(item.caption ?? "")}" />`;
        const badge = props.evidenceBadge ? `<span class="tpl-photo-badge">Evidence</span>` : "";
        const caption =
          props.showCaption && (item.caption || item.stamp)
            ? `<figcaption class="tpl-photo-cap">${esc(item.caption ?? "")}${item.stamp ? ` <span class="tpl-photo-stamp">${esc(item.stamp)}</span>` : ""}</figcaption>`
            : "";
        return `<figure class="tpl-photo">${media}${badge}${caption}</figure>`;
      })
      .join("");
    const more =
      items.length > props.max
        ? `<p class="tpl-photo-more">+${items.length - props.max} more</p>`
        : "";
    return `<div class="tpl-photo-grid" data-cols="${props.columns}">${figures}</div>${more}`;
  },
  renderEmail(props, ctx) {
    const source = getPath(ctx.data, props.bind);
    const items: MediaItem[] = Array.isArray(source) ? (source as MediaItem[]) : [];
    if (items.length === 0) {
      return emailRow(
        `<p style="margin:0;font-family:${ctx.brand.font.body};font-size:13px;color:${ctx.brand.color.muted};">${esc(props.emptyText)}</p>`,
      );
    }
    const shown = items.slice(0, props.max);
    const cell = (item: MediaItem): string => {
      const media =
        item.type === "VIDEO"
          ? `<a href="${esc(item.url)}" style="display:block;padding:24px 12px;text-align:center;font-family:${ctx.brand.font.body};font-size:13px;color:${ctx.brand.color.ink};background:#F1EEE8;border-radius:6px;text-decoration:none;">▶ ${esc(item.caption ?? "Video")}</a>`
          : `<img width="260" style="display:block;max-width:100%;border:0;border-radius:6px;" src="${esc(item.url)}" alt="${esc(item.caption ?? "")}" />`;
      const caption =
        props.showCaption && (item.caption || item.stamp)
          ? `<p style="margin:6px 0 0;font-family:${ctx.brand.font.body};font-size:12px;color:${ctx.brand.color.muted};">${esc(item.caption ?? "")}${item.stamp ? ` ${esc(item.stamp)}` : ""}</p>`
          : "";
      return `<td width="50%" valign="top" style="padding:6px;">${media}${caption}</td>`;
    };
    let rows = "";
    for (let i = 0; i < shown.length; i += 2) {
      const left = cell(shown[i]);
      const right = shown[i + 1] ? cell(shown[i + 1]) : `<td width="50%" style="padding:6px;">&nbsp;</td>`;
      rows += `<tr>${left}${right}</tr>`;
    }
    return emailRow(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
    );
  },
};
