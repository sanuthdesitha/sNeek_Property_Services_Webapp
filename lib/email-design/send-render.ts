import "server-only";
/**
 * The send path's half of the email design system, called by
 * lib/notifications/email.ts just before the sending safeguards. It renders
 * every email again at send time so the published version, the published
 * Email look and the current Company details apply, and produces the
 * plain-text part:
 * - a block design (spec "design"): the published version or the standard;
 *   required values that are empty make the send refuse (`missing`);
 * - a shared template an admin edited as raw HTML (spec "legacy" with a key):
 *   a published block version replaces it; until then its HTML body goes on
 *   the base layout;
 * - any other HTML body (wording layer, routes): put on the base layout;
 * - a campaign: blocks on the base layout with the campaign footer and the
 *   one-click unsubscribe link;
 * - a full HTML document with no spec: sent as it is (text part generated).
 * Reading the design or theme can fail; the standard is then used.
 */
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings, type AppSettings } from "@/lib/settings";
import { bodyOf, businessFromSettings, campaignDocument, commonValues, composeDesign, composeLegacyBody } from "./compose";
import { MARKETING_LAYOUT_DEFINITION, emailDesign } from "./registry";
import { fragmentToText, renderEmailDocument } from "./render";
import { extractSpec, resolveSubject, type EmailSpec } from "./spec";
import { getPublishedDocument, getPublishedEmailTheme } from "./store";
import { marketingUnsubscribeUrl, UNSUBSCRIBE_PATH } from "./unsubscribe";
import type { EmailTheme } from "./types";

export type OutgoingEmailInput = {
  to: string[];
  subject: string;
  html: string;
  critical?: boolean;
  /** Campaign email: base layout with the unsubscribe footer and List-Unsubscribe headers. */
  marketing?: boolean;
};

export type OutgoingEmail = {
  subject: string;
  html: string;
  text: string;
  /** Labels of required values that are empty: the email must not be sent. */
  missing: string[];
  /** A security email (no reply-to). */
  security: boolean;
  headers: Record<string, string>;
  theme: EmailTheme;
  settings: AppSettings;
  /** Which path produced it (for logs and tests). */
  path: "design" | "legacy-template" | "legacy-body" | "campaign" | "document";
  designKey: string | null;
};

function absolutizeInlineLinks(html: string): string {
  return html.replace(/(href|src)="(\/[^"]*)"/gi, (_, attr: string, value: string) => `${attr}="${resolveAppUrl(value)}"`);
}

function appBase(): string {
  return resolveAppUrl("/").replace(/\/+$/, "");
}

async function renderSpec(spec: EmailSpec, input: OutgoingEmailInput, theme: EmailTheme, settings: AppSettings): Promise<Omit<OutgoingEmail, "headers" | "theme" | "settings">> {
  const business = businessFromSettings(settings);
  const appUrl = appBase();
  const definition = spec.key ? emailDesign(spec.key) : null;
  // A test send carries its draft; everything else uses the published version.
  const published = definition ? spec.doc ?? (await getPublishedDocument(definition)) : null;
  if (definition && (spec.kind === "design" || published)) {
    const rendered = composeDesign(definition, published ?? definition.defaults, spec.values, { theme, business, appUrl, mode: "send", settings });
    return { subject: resolveSubject(input.subject, spec, rendered.subject), html: rendered.html, text: rendered.text, missing: rendered.missing, security: definition.security, path: "design", designKey: definition.key };
  }
  const security = Boolean(spec.security || input.critical);
  const legacy = composeLegacyBody(spec.body ?? "", { theme, business, appUrl, mode: "send", subject: input.subject, action: spec.action ?? null, security });
  return { subject: input.subject, html: legacy.html, text: legacy.text, missing: [], security, path: spec.key ? "legacy-template" : "legacy-body", designKey: null };
}

function renderCampaign(html: string, input: OutgoingEmailInput, theme: EmailTheme, settings: AppSettings): Omit<OutgoingEmail, "theme" | "settings"> {
  const business = businessFromSettings(settings);
  const appUrl = appBase();
  const recipient = input.to.length === 1 ? input.to[0] : "";
  const unsubscribeUrl = recipient ? marketingUnsubscribeUrl(recipient, appUrl) : null;
  const headers: Record<string, string> = {};
  const mailto = settings.accountsEmail ? `<mailto:${settings.accountsEmail}?subject=unsubscribe>` : "";
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = [`<${unsubscribeUrl}>`, mailto].filter(Boolean).join(", ");
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  } else if (mailto) {
    headers["List-Unsubscribe"] = mailto;
  }
  const converted = campaignDocument(html);
  if (converted) {
    const rendered = renderEmailDocument(converted.doc, { ...commonValues(settings, appUrl), ...converted.values }, { theme, business, definition: converted.definition, mode: "send", unsubscribeUrl });
    return { subject: input.subject, html: rendered.html, text: rendered.text, missing: [], security: false, headers, path: "campaign", designKey: null };
  }
  const body = /^<!doctype html>/i.test(html.trim()) ? bodyOf(html) : html;
  const legacy = composeLegacyBody(body, { theme, business, appUrl, mode: "send", subject: input.subject, definition: MARKETING_LAYOUT_DEFINITION, unsubscribeUrl });
  return { subject: input.subject, html: legacy.html, text: legacy.text, missing: [], security: false, headers, path: "campaign", designKey: null };
}

/** Everything the provider call needs, rendered at send time. */
export async function prepareOutgoingEmail(input: OutgoingEmailInput): Promise<OutgoingEmail> {
  const [settings, theme] = await Promise.all([getAppSettings(), getPublishedEmailTheme()]);
  const { spec, html: stripped } = extractSpec(input.html.trim());
  const base = { theme, settings };
  if (input.marketing) {
    const campaign = renderCampaign(stripped, input, theme, settings);
    return { ...campaign, ...base, html: absolutizeInlineLinks(campaign.html) };
  }
  if (spec) {
    const specTheme = spec.theme ?? theme;
    const rendered = await renderSpec(spec, input, specTheme, settings);
    return { ...rendered, ...base, theme: specTheme, headers: {}, html: absolutizeInlineLinks(rendered.html) };
  }
  if (/^<!doctype html>/i.test(stripped)) {
    return { subject: input.subject, html: absolutizeInlineLinks(stripped), text: `${fragmentToText(bodyOf(stripped))}\n`, missing: [], security: Boolean(input.critical), headers: {}, path: "document", designKey: null, ...base };
  }
  const legacy = composeLegacyBody(stripped, { theme, business: businessFromSettings(settings), appUrl: appBase(), mode: "send", subject: input.subject, security: Boolean(input.critical) });
  return { subject: input.subject, html: absolutizeInlineLinks(legacy.html), text: legacy.text, missing: [], security: Boolean(input.critical), headers: {}, path: "legacy-body", designKey: null, ...base };
}

/** "Name <address>" from the Email look sender name and EMAIL_FROM (the address is set by the server). */
export function senderAddress(configured: string, senderName: string): string {
  if (!senderName.trim()) return configured;
  const match = /<([^>]+)>/.exec(configured);
  const address = (match ? match[1] : configured).trim();
  const name = senderName.replace(/["\\<>\r\n]/g, "").trim();
  return name ? `"${name}" <${address}>` : configured;
}

export { UNSUBSCRIBE_PATH };
