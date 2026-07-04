/**
 * Template engine v2 — the channel-agnostic TemplateDoc block model
 * (rebrand doc 03 §1). One JSON document model, four renderers
 * (email / pdf / web / text), one brand-token source.
 *
 * The doc is a flat vertical block stack (email constraint: free canvases
 * don't survive Gmail/Outlook — proven by lib/templates/email-blocks.ts).
 */

import { z } from "zod";

export type Channel = "email" | "pdf" | "web" | "sms";

/**
 * Template kinds are namespaced strings: "email.*" | "doc.*" | "sms.*".
 * The strict per-kind config (data contract, allowed blocks, chrome) lives in
 * lib/templates/kinds.ts — adding a kind is data, not editor code.
 */
export type TemplateKind = `email.${string}` | `doc.${string}` | `sms.${string}`;

export const CHANNELS: Channel[] = ["email", "pdf", "web", "sms"];

// ---------------------------------------------------------------------------
// Style + conditions
// ---------------------------------------------------------------------------

/**
 * Style overrides on a block. Color-ish values may be brand-token refs
 * ("color.accent") or literals ("#C0A265") — resolved at render time.
 */
export const blockStyleSchema = z
  .object({
    background: z.string().optional(),
    color: z.string().optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    paddingY: z.number().int().min(0).max(96).optional(),
    paddingX: z.number().int().min(0).max(96).optional(),
    fontSize: z.number().int().min(10).max(64).optional(),
  })
  .strict();

export type BlockStyle = z.infer<typeof blockStyleSchema>;

/**
 * Conditional rendering expression (§1.2): a dotted data path, optionally
 * negated ("!invoice.gstEnabled"). Truthy ⇒ render. Arrays count as truthy
 * when non-empty. Deliberately minimal — richer operators can come later
 * without breaking stored docs.
 */
export const mergeExprSchema = z.string().min(1).max(200);
export type MergeExpr = z.infer<typeof mergeExprSchema>;

export function evaluateWhen(expr: MergeExpr | undefined, data: unknown): boolean {
  if (!expr) return true;
  const negated = expr.startsWith("!");
  const path = negated ? expr.slice(1).trim() : expr.trim();
  const value = getPath(data, path);
  const truthy = Array.isArray(value) ? value.length > 0 : Boolean(value);
  return negated ? !truthy : truthy;
}

/** Dotted-path lookup into the render data context. */
export function getPath(data: unknown, path: string): unknown {
  if (!path) return undefined;
  let node: unknown = data;
  for (const part of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const BLOCK_TYPES = [
  "header",
  "hero",
  "heading",
  "text",
  "statRow",
  "infoCard",
  "lineItems",
  "totals",
  "terms",
  "button",
  "callout",
  "image",
  "divider",
  "spacer",
  "pageBreak",
  "footer",
  "textBlock",
  // Report-wave blocks (rebrand doc 03 §1.3) — registered in blocks/defs/.
  "checklistSection",
  "photoGrid",
  "qaScoreCard",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const blockBaseSchema = z.object({
  id: z.string().min(1),
  type: z.enum(BLOCK_TYPES),
  /** Conditional rendering, e.g. "invoice.gstEnabled". */
  when: mergeExprSchema.optional(),
  /** Restrict to specific channels; omit = all channels the kind targets. */
  channels: z.array(z.enum(["email", "pdf", "web", "sms"])).optional(),
  style: blockStyleSchema.partial().optional(),
  /** Block-type-specific props, validated by the block's registry propsSchema. */
  props: z.record(z.unknown()).default({}),
});

export type Block = z.infer<typeof blockBaseSchema>;

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export const themeOverrideSchema = z
  .object({
    accent: z.string().optional(),
    primary: z.string().optional(),
    headerTreatment: z.enum(["standard", "band", "minimal"]).optional(),
    density: z.enum(["comfortable", "compact"]).optional(),
    logoVariant: z.enum(["default", "document"]).optional(),
  })
  .strict();

export type ThemeOverride = z.infer<typeof themeOverrideSchema>;

export const templateDocSchema = z.object({
  /** Model version — distinct from the content version in TemplateVersion. */
  version: z.literal(2),
  kind: z.string().min(1),
  page: z
    .object({
      size: z.literal("A4").optional(),
      margin: z.string().optional(),
      /** Token ref or literal color. */
      background: z.string().default("color.surface"),
    })
    .default({ background: "color.surface" }),
  theme: themeOverrideSchema.default({}),
  blocks: z.array(blockBaseSchema).default([]),
});

export type TemplateDoc = z.infer<typeof templateDocSchema>;

/** Parse + validate a stored doc (e.g. TemplateVersion.doc). Throws ZodError. */
export function parseTemplateDoc(raw: unknown): TemplateDoc {
  return templateDocSchema.parse(raw);
}

/** Non-throwing variant for render paths that must fail soft. */
export function safeParseTemplateDoc(raw: unknown): TemplateDoc | null {
  const result = templateDocSchema.safeParse(raw);
  return result.success ? result.data : null;
}

let idCounter = 0;
/** Stable-ish block id generator (app runtime only — not for workflows). */
export function newBlockId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}_${idCounter}`;
}

export function emptyDoc(kind: TemplateKind): TemplateDoc {
  return {
    version: 2,
    kind,
    page: { background: "color.surface" },
    theme: {},
    blocks: [],
  };
}
