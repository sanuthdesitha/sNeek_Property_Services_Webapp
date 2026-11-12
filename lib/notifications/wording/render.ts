import "server-only";
import { renderEmailTemplate } from "@/lib/email-templates";
import { logger } from "@/lib/logger";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { renderHtml, renderPlain, type TemplateValues } from "./template";
import { wordingDefinition } from "./registry";
import { liveStoreOverride, readStoredRow } from "./store";
import { variableFormats } from "./variables";
import type { WordingFields, WordingPartDefinition, WordingTransport } from "./types";

/**
 * THE render function for notification wording. Every send path that has a
 * wording definition renders through it:
 * - plain {{variable}} substitution only (template.ts): nothing executes;
 * - email bodies escape every value (pre-built "html" fragments excepted);
 * - a saved override is used only when it is still valid for the part,
 *   otherwise the default is used (and logged);
 * - with no override the output is byte-identical to the wording the code
 *   composed before (tests/lib/notification-wording-parity.test.ts);
 * - email-template parts render through the existing shared template
 *   renderer (renderEmailTemplate), which reads the same store this layer
 *   edits.
 */
export type RenderedWording = {
  /** INBOX / PUSH */
  title: string;
  /** INBOX / PUSH / SMS: plain text. EMAIL: the HTML body. */
  body: string;
  /** EMAIL */
  subject: string;
  /** EMAIL: the full HTML to send (same as body for store parts; wrapped for template parts). */
  html: string;
  source: "default" | "override";
};

export type WordingRenderer = {
  typeKey: string;
  render(partId: string, transport: WordingTransport, values: TemplateValues): RenderedWording;
  /** A "line" part (a fixed sentence used only when its condition holds); "" when the condition is false. */
  line(partId: string, transport: WordingTransport, values: TemplateValues, when?: boolean): string;
};

type Overrides = ReadonlyMap<string, WordingFields>;

/** Logging must never stop a notification from going out. */
function warn(details: Record<string, unknown>, message: string): void {
  try {
    logger.warn(details, message);
  } catch {
    // ignore: the default wording is used either way
  }
}

function findPart(typeKey: string, partId: string, transport: WordingTransport): WordingPartDefinition {
  const part = wordingDefinition(typeKey)?.parts.find((item) => item.id === partId && item.transport === transport);
  if (!part) throw new Error(`No wording part ${typeKey}/${partId}/${transport}`);
  return part;
}

function renderPart(part: WordingPartDefinition, fields: WordingFields, values: TemplateValues): Omit<RenderedWording, "source"> {
  if (part.transport === "EMAIL") {
    const html = renderHtml(fields.body ?? "", values, variableFormats(part.variables));
    return { title: "", body: html, subject: renderPlain(fields.subject ?? "", values), html };
  }
  return { title: renderPlain(fields.title ?? "", values), body: renderPlain(fields.body ?? "", values), subject: "", html: "" };
}

function makeRenderer(typeKey: string, overrides: Overrides, settings: AppSettings | null): WordingRenderer {
  function render(partId: string, transport: WordingTransport, values: TemplateValues): RenderedWording {
    const part = findPart(typeKey, partId, transport);
    if (part.source.kind === "EMAIL_TEMPLATE") {
      if (!settings) throw new Error(`Settings are needed to render ${typeKey}/${partId}`);
      const rendered = renderEmailTemplate(settings, part.source.key, values as Record<string, unknown>);
      return { title: "", body: rendered.html, subject: rendered.subject, html: rendered.html, source: "default" };
    }
    const override = overrides.get(`${part.id}:${part.transport}`);
    return { ...renderPart(part, override ?? part.defaults, values), source: override ? "override" : "default" };
  }
  return {
    typeKey,
    render,
    line(partId, transport, values, when = true) {
      if (!when) return "";
      return render(partId, transport, values).body;
    },
  };
}

/** The defaults only (no store read). For previews before the store loads and for parity tests. */
export function defaultNotificationWording(typeKey: string, settings: AppSettings | null = null): WordingRenderer {
  return makeRenderer(typeKey, new Map(), settings);
}

/**
 * Loads a type's live overrides once (for a batch of recipients). A store or
 * settings read that fails falls back to the defaults: the notification still
 * goes out with the wording it always had, and the failure is logged.
 */
export async function loadNotificationWording(typeKey: string): Promise<WordingRenderer> {
  const definition = wordingDefinition(typeKey);
  const parts = definition?.parts ?? [];
  const overrides = new Map<string, WordingFields>();
  let settings: AppSettings | null = null;
  try {
    if (parts.some((part) => part.source.kind === "STORE")) {
      const row = await readStoredRow(typeKey);
      for (const part of parts) {
        if (part.source.kind !== "STORE") continue;
        const live = liveStoreOverride(row, part);
        if (live) overrides.set(`${part.id}:${part.transport}`, live);
        else if ((row.entries[`${part.id}:${part.transport}`] ?? []).at(-1)?.fields) warn({ typeKey, part: part.id, transport: part.transport }, "Invalid notification wording override; the default was used");
      }
    }
  } catch (error) {
    warn({ typeKey, error: error instanceof Error ? error.message : String(error) }, "Notification wording overrides unavailable; defaults used");
    overrides.clear();
  }
  if (parts.some((part) => part.source.kind === "EMAIL_TEMPLATE")) settings = await getAppSettings();
  return makeRenderer(typeKey, overrides, settings);
}

/** One-shot render of one part (the first part of that transport unless `part` is given). */
export async function renderNotificationWording(typeKey: string, transport: WordingTransport, variables: TemplateValues, options: { part?: string } = {}): Promise<RenderedWording> {
  const definition = wordingDefinition(typeKey);
  const partId = options.part ?? definition?.parts.find((part) => part.transport === transport && !part.fields)?.id;
  if (!partId) throw new Error(`No ${transport} wording for ${typeKey}`);
  return (await loadNotificationWording(typeKey)).render(partId, transport, variables);
}
