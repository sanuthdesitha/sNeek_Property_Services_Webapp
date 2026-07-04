/**
 * Block registry contracts (rebrand doc 03 §1.3).
 * Each block declares its props schema, allowed channels, defaults, and one
 * renderer per channel family. Adding a block = one registry entry — the
 * editor (phase 2) auto-generates its inspector from propsSchema.
 */

import type { z } from "zod";
import type { BrandTokens } from "@/lib/brand/tokens";
import type { BlockStyle, BlockType, Channel, ThemeOverride } from "../model";

export interface BlockRenderCtx {
  channel: Channel;
  brand: BrandTokens;
  theme: ThemeOverride;
  /** Render data context (the kind's zod-typed contract). */
  data: unknown;
  /** Resolve merge fields, HTML-escaped. */
  merge: (template: string) => string;
  /** Resolve merge fields, raw (SMS / attribute-safe use only). */
  mergeText: (template: string) => string;
  /** Resolve a color that may be a token ref ("color.accent") or literal. */
  color: (ref: string | undefined, fallback: string) => string;
  /** Effective style for the current block (defaults merged with overrides). */
  style: BlockStyle;
}

// Timezone travels with the ctx object (WeakMap keeps BlockRenderCtx lean for
// block authors while formatters can still reach the settings tz).
const CTX_TZ = new WeakMap<object, string>();

export function setCtxTimezone(ctx: BlockRenderCtx, tz: string): void {
  CTX_TZ.set(ctx, tz);
}

export function getCtxTimezone(ctx: BlockRenderCtx): string {
  return CTX_TZ.get(ctx) ?? "Australia/Sydney";
}

export interface BlockDefinition<P = Record<string, unknown>> {
  type: BlockType;
  label: string;
  /** Channels this block can target. */
  channels: Channel[];
  /** Input type is loose (unknown) because .default() makes inputs optional. */
  propsSchema: z.ZodType<P, z.ZodTypeDef, unknown>;
  defaults: () => P;
  /** Table-based inline-styled email HTML (600px shell). */
  renderEmail?: (props: P, ctx: BlockRenderCtx) => string;
  /** Semantic HTML for A4 pdf + web portal viewing (shares CSS classes). */
  renderDocument?: (props: P, ctx: BlockRenderCtx) => string;
  /** Plain text (SMS bodies, email text-parts). */
  renderText?: (props: P, ctx: BlockRenderCtx) => string;
}
