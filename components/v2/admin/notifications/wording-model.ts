/**
 * Pure helpers for the wording editor (no "use client"; tested directly).
 */
import { checkWording, renderHtml, renderPlain, smsLength, type SmsLength, type WordingProblem } from "@/lib/notifications/wording/template";
import { WORDING_TRANSPORTS, type WordingFields, type WordingTransport } from "@/lib/notifications/wording/types";
import type { WordingPartView } from "@/lib/notifications/wording/view-types";

export function draftKey(part: Pick<WordingPartView, "id" | "transport">): string {
  return `${part.id}:${part.transport}`;
}

/** The parts edited on a transport tab: Push falls back to inbox parts whose text is also the push. */
export function partsForTab(parts: readonly WordingPartView[], tab: WordingTransport): WordingPartView[] {
  const own = parts.filter((part) => part.transport === tab);
  if (own.length || tab !== "PUSH") return own;
  return parts.filter((part) => part.transport === "INBOX" && part.push === "SHARED");
}

export type TabState = { transport: WordingTransport; enabled: boolean; title: string | null };

export function tabStates(parts: readonly WordingPartView[], catalogTransports: readonly string[]): TabState[] {
  return WORDING_TRANSPORTS.map((transport) => {
    const enabled = partsForTab(parts, transport).length > 0;
    let title: string | null = null;
    if (!enabled) {
      const sent = transport === "INBOX" ? catalogTransports.includes("INBOX") : transport === "PUSH" ? catalogTransports.some((item) => item === "MOBILE_PUSH" || item === "WEB_PUSH") : catalogTransports.includes(transport);
      title = sent ? "This wording is still written in code" : `Not sent by ${transport === "INBOX" ? "the inbox" : transport.toLowerCase()}`;
    }
    return { transport, enabled, title };
  });
}

/** The first tab with wording (the board opens on the transport being edited). */
export function firstTab(parts: readonly WordingPartView[]): WordingTransport | null {
  return tabStates(parts, []).find((tab) => tab.enabled)?.transport ?? null;
}

export function sameFields(a: WordingFields, b: WordingFields): boolean {
  return (a.title ?? "") === (b.title ?? "") && (a.subject ?? "") === (b.subject ?? "") && (a.body ?? "") === (b.body ?? "");
}

export function problemsFor(part: WordingPartView, fields: WordingFields): WordingProblem[] {
  return checkWording({ transport: part.transport, fields, fieldNames: part.fields, allowed: part.variables.map((variable) => variable.name), required: part.required });
}

export function sampleValuesFor(part: WordingPartView): Record<string, string> {
  return Object.fromEntries(part.variables.map((variable) => [variable.name, variable.sample]));
}

export type PartPreview = { title: string; subject: string; body: string; html: string; sms: SmsLength | null };

/** Renders a part with its sample values, exactly as the server's template language does. */
export function previewPart(part: WordingPartView, fields: WordingFields): PartPreview {
  const values = sampleValuesFor(part);
  if (part.transport === "EMAIL") {
    const formats = Object.fromEntries(part.variables.map((variable) => [variable.name, variable.format]));
    return { title: "", subject: renderPlain(fields.subject ?? "", values), body: "", html: renderHtml(fields.body ?? "", values, formats), sms: null };
  }
  const body = renderPlain(fields.body ?? "", values);
  return { title: renderPlain(fields.title ?? "", values), subject: "", body, html: "", sms: part.transport === "SMS" ? smsLength(body) : null };
}

/** Inserts `{{name}}` at the caret of a field value; returns the new value and caret position. */
export function insertVariable(value: string, selectionStart: number | null, selectionEnd: number | null, name: string): { value: string; caret: number } {
  const token = `{{${name}}}`;
  const start = Math.max(0, Math.min(selectionStart ?? value.length, value.length));
  const end = Math.max(start, Math.min(selectionEnd ?? start, value.length));
  return { value: value.slice(0, start) + token + value.slice(end), caret: start + token.length };
}

export function nextVersion(part: WordingPartView): number {
  return Math.max(1, ...part.versions.map((version) => version.version)) + 1;
}

/** Plain text of an HTML email body for a one-line summary (preview only). */
export function htmlToText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}
