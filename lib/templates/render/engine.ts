/**
 * Render engine core — walks a TemplateDoc's block stack through the registry.
 * Renderers are pure: (doc, data, brand, opts) → output. No I/O here; callers
 * fetch settings/data and (for pdf) pipe the HTML into renderPdfFromHtml().
 */

import { resolveTokenRef, type BrandTokens } from "@/lib/brand/tokens";
import { BLOCK_REGISTRY } from "../blocks/registry";
import { setCtxTimezone, type BlockRenderCtx } from "../blocks/types";
// (setCtxTimezone lives beside BlockRenderCtx so block renderers can read the tz)
import { resolveMergeHtml, resolveMergeText } from "../merge";
import { evaluateWhen, type Block, type Channel, type TemplateDoc } from "../model";

export interface RenderOptions {
  /** IANA timezone for date formatting; defaults to Australia/Sydney. */
  timezone?: string;
  /** Collects unresolved merge paths (publish lint / editor red chips). */
  unresolved?: Set<string>;
}

export function makeBlockCtx(
  doc: TemplateDoc,
  block: Block,
  channel: Channel,
  data: unknown,
  brand: BrandTokens,
  opts: RenderOptions,
): BlockRenderCtx {
  const timezone = opts.timezone ?? "Australia/Sydney";
  const mergeCtx = { data, timezone, unresolved: opts.unresolved };
  const ctx: BlockRenderCtx = {
    channel,
    brand,
    theme: doc.theme,
    data,
    merge: (template) => resolveMergeHtml(template, mergeCtx),
    mergeText: (template) => resolveMergeText(template, mergeCtx),
    color: (ref, fallback) => (ref ? resolveTokenRef(brand, ref) : fallback),
    style: block.style ?? {},
  };
  setCtxTimezone(ctx, timezone);
  return ctx;
}

/**
 * Render every visible block for a channel via the given per-channel renderer
 * name, concatenating string output. Blocks that don't support the channel,
 * fail their `when`, or lack a renderer are skipped (never throw mid-render).
 */
export function renderBlocks(
  doc: TemplateDoc,
  channel: Channel,
  renderer: "renderEmail" | "renderDocument" | "renderText",
  data: unknown,
  brand: BrandTokens,
  opts: RenderOptions,
): string {
  const out: string[] = [];
  for (const block of doc.blocks) {
    const def = BLOCK_REGISTRY[block.type];
    if (!def) continue;
    if (!def.channels.includes(channel)) continue;
    if (block.channels && !block.channels.includes(channel)) continue;
    if (!evaluateWhen(block.when, data)) continue;
    const renderFn = def[renderer];
    if (!renderFn) continue;
    const parsed = def.propsSchema.safeParse(block.props ?? {});
    const props = parsed.success ? parsed.data : def.defaults();
    try {
      const html = renderFn(props, makeBlockCtx(doc, block, channel, data, brand, opts));
      if (html) out.push(html);
    } catch {
      // A single broken block must not take down an invoice/report render.
    }
  }
  return out.join("\n");
}
