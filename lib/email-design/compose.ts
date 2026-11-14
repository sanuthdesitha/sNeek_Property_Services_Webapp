/**
 * Putting an email together: business details, the values every email gets,
 * the preferences link, a block design, an HTML body on the base layout
 * (legacy and campaign) and the spec the send path renders again. Plain
 * module: the editor preview runs it in the browser with the same inputs.
 */
import { renderBodyRows, renderEmailDocument, renderLayout, escapeHtml, fragmentToText, safeHref, type RenderDefinition, type RenderScheme, type RenderedEmail } from "./render";
import { embedSpec, type EmailSpec } from "./spec";
import { LEGACY_LAYOUT_DEFINITION, MARKETING_LAYOUT_DEFINITION } from "./registry";
import { inline } from "./inline";
import type { BusinessDetails, EmailBlock, EmailDesignDefinition, EmailDocument, EmailTheme, EmailVariable, PreferencesTarget } from "./types";

/** The parts of the app settings the layout reads (Company details). */
export type CompanySettingsLike = {
  companyName: string;
  companyPhone?: string;
  logoUrl?: string;
  logoDarkBgUrl?: string;
  accountsEmail?: string;
  timezone?: string;
  invoicing?: { abn?: string; companyAddress?: string };
};

export function businessFromSettings(settings: CompanySettingsLike): BusinessDetails {
  return {
    companyName: settings.companyName || "sNeek Property Services",
    abn: settings.invoicing?.abn?.trim() ?? "",
    address: settings.invoicing?.companyAddress?.replace(/\s*\n\s*/g, ", ").trim() ?? "",
    phone: settings.companyPhone?.trim() ?? "",
    contactEmail: settings.accountsEmail?.trim() ?? "",
    logoUrl: settings.logoUrl?.trim() ?? "",
    logoDarkUrl: settings.logoDarkBgUrl?.trim() ?? "",
  };
}

function joinUrl(appUrl: string, path: string): string {
  return `${appUrl.replace(/\/+$/, "")}${path}`;
}

const PREFERENCES_PATH: Record<PreferencesTarget, string | null> = {
  cleaner: "/v2/cleaner/settings",
  client: "/v2/client/settings",
  laundry: "/v2/laundry/settings",
  staff: "/v2/admin/profile",
  none: null,
};

export function preferencesUrl(target: PreferencesTarget, appUrl: string): string | null {
  const path = PREFERENCES_PATH[target];
  return path && /^https?:\/\//i.test(appUrl) ? joinUrl(appUrl, path) : null;
}

/** Uploaded logos are stored as app paths ("/api/uploads/…"); an inbox needs the full link. */
function absolute(url: string, appUrl: string): string {
  return url.startsWith("/") && /^https?:\/\//i.test(appUrl) ? joinUrl(appUrl, url) : url;
}

export function absoluteTheme(theme: EmailTheme, appUrl: string): EmailTheme {
  return { ...theme, logoUrl: absolute(theme.logoUrl, appUrl), logoDarkUrl: absolute(theme.logoDarkUrl, appUrl) };
}

export function absoluteBusiness(business: BusinessDetails, appUrl: string): BusinessDetails {
  return { ...business, logoUrl: absolute(business.logoUrl, appUrl), logoDarkUrl: absolute(business.logoDarkUrl, appUrl) };
}

/** Values every email gets (the shared templates' common variables). */
export function commonValues(settings: CompanySettingsLike, appUrl: string, now = new Date()): Record<string, string> {
  const timeZone = settings.timezone || "Australia/Sydney";
  const date = new Intl.DateTimeFormat("en-AU", { timeZone, year: "numeric", month: "long", day: "numeric" }).format(now);
  return {
    companyName: settings.companyName || "sNeek Property Services",
    appUrl: joinUrl(appUrl, "/"),
    portalUrl: joinUrl(appUrl, "/"),
    loginUrl: joinUrl(appUrl, "/login"),
    supportEmail: settings.accountsEmail ?? "",
    currentDate: date,
  };
}

export type ComposeInput = {
  theme: EmailTheme;
  business: BusinessDetails;
  appUrl: string;
  mode: "send" | "preview";
  scheme?: RenderScheme;
};

/** Render one design document with its values (common values filled in). */
/** Fixed values of a design (links written in an old body), made absolute. */
function constantValues(definition: EmailDesignDefinition, appUrl: string): Record<string, string> {
  return Object.fromEntries(definition.variables.filter((variable) => variable.constant).map((variable) => [variable.name, variable.constant!.startsWith("/") ? joinUrl(appUrl, variable.constant!) : variable.constant!]));
}

export function composeDesign(definition: EmailDesignDefinition, doc: EmailDocument, values: Record<string, string>, input: ComposeInput & { settings: CompanySettingsLike }): RenderedEmail {
  const merged: Record<string, string> = { ...commonValues(input.settings, input.appUrl), ...values };
  for (const [name, value] of Object.entries(constantValues(definition, input.appUrl))) if (!String(merged[name] ?? "").trim()) merged[name] = value;
  // Links built as app paths ("/v2/…") become full links (the send path did this for href="/…").
  for (const variable of definition.variables) if (variable.format === "url" && typeof merged[variable.name] === "string") merged[variable.name] = absolute(merged[variable.name].trim(), input.appUrl);
  return renderEmailDocument(doc, merged, {
    theme: absoluteTheme(input.theme, input.appUrl),
    business: absoluteBusiness(input.business, input.appUrl),
    definition,
    mode: input.mode,
    scheme: input.scheme,
    preferencesUrl: preferencesUrl(definition.preferences, input.appUrl),
  });
}

/** An HTML body (a raw-HTML template, a wording-layer or route fragment) on the base layout. */
export function composeLegacyBody(body: string, input: ComposeInput & {
  subject: string;
  action?: { url: string; label: string } | null;
  security?: boolean;
  definition?: RenderDefinition;
  unsubscribeUrl?: string | null;
}): { html: string; text: string } {
  const definition: RenderDefinition = input.definition ?? { ...LEGACY_LAYOUT_DEFINITION, security: Boolean(input.security) };
  const options = { theme: absoluteTheme(input.theme, input.appUrl), business: absoluteBusiness(input.business, input.appUrl), definition, mode: input.mode, scheme: input.scheme, preferencesUrl: null, unsubscribeUrl: input.unsubscribeUrl ?? null };
  const href = input.action ? safeHref(input.action.url) : null;
  const buttonDoc: EmailDocument | null = href && input.action
    ? { subject: [], preheader: [], blocks: [{ id: "b1", type: "button", label: input.action.label, link: "actionUrl" }] }
    : null;
  const buttonRows = buttonDoc
    ? renderBodyRows(buttonDoc, { actionUrl: href as string }, { ...options, definition: { ...definition, variables: [{ name: "actionUrl", label: "Link", sample: "", format: "url" }] } }).rows
    : "";
  const bodyRow = `<tr><td class="sn-px sn-tx" style="padding:24px 32px 12px;font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">${body}</td></tr>`;
  const html = renderLayout({ options, subject: input.subject, preheader: "", reference: "", bodyRows: `${bodyRow}${buttonRows}` });
  const footerText = [
    "--",
    input.business.companyName,
    definition.security ? "Security emails can't be turned off." : definition.whyLine,
    ...(input.unsubscribeUrl ? [`Unsubscribe: ${input.unsubscribeUrl}`] : []),
  ];
  const text = [input.business.companyName, "", fragmentToText(body), ...(href && input.action ? ["", `${input.action.label}:`, href] : []), "", ...footerText].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return { html, text };
}

/** The inner body of a full HTML document (a campaign stored as a document). */
export function bodyOf(html: string): string {
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  return match ? match[1] : html;
}

type CampaignDesignBlock = { type?: unknown; text?: unknown; href?: unknown; src?: unknown; alt?: unknown };

/**
 * A campaign built in the block designer (its design JSON travels in the
 * HTML) as a block document on the base layout. The designer's free colours,
 * sizes and alignment are not used: the theme sets them. Null when the HTML
 * carries no readable design (it is then put on the layout as a body).
 */
export function campaignDocument(html: string): { doc: EmailDocument; values: Record<string, string>; definition: RenderDefinition } | null {
  const marker = "<!--SNEEK_EMAIL_DESIGN:";
  const index = html.indexOf(marker);
  if (index === -1) return null;
  const end = html.indexOf("-->", index + marker.length);
  if (end === -1) return null;
  let parsed: { blocks?: CampaignDesignBlock[] };
  try {
    parsed = JSON.parse(html.slice(index + marker.length, end)) as { blocks?: CampaignDesignBlock[] };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.blocks)) return null;
  const values: Record<string, string> = {};
  const variables: EmailVariable[] = [];
  const blocks: EmailBlock[] = [];
  let buttonUsed = false;
  parsed.blocks.slice(0, 30).forEach((block, position) => {
    const id = `b${position + 1}`;
    const text = typeof block.text === "string" ? block.text : "";
    if (block.type === "heading" && text.trim()) blocks.push({ id, type: "heading", text: [{ kind: "text", text }] });
    else if (block.type === "text" && text.trim()) blocks.push({ id, type: "paragraph", text: [{ kind: "text", text }] });
    else if (block.type === "divider") blocks.push({ id, type: "divider" });
    else if (block.type === "button" && typeof block.href === "string" && safeHref(block.href)) {
      const name = `link${position + 1}`;
      values[name] = block.href;
      variables.push({ name, label: "Link", sample: "", format: "url" });
      if (!buttonUsed) {
        blocks.push({ id, type: "button", label: text || "Open", link: name });
        buttonUsed = true;
      } else {
        blocks.push({ id, type: "paragraph", text: [{ kind: "text", text: `${text || "Link"}: ` }, { kind: "value", name }] });
      }
    } else if (block.type === "image" && typeof block.src === "string" && /^https?:\/\//i.test(block.src)) {
      const name = `image${position + 1}`;
      values[name] = JSON.stringify([{ url: block.src, caption: typeof block.alt === "string" ? block.alt : "" }]);
      variables.push({ name, label: "Image", sample: "", format: "photos" });
      blocks.push({ id, type: "photos", source: name, caption: [] });
    }
  });
  if (blocks.length === 0) return null;
  return { doc: { subject: [], preheader: [], blocks }, values, definition: { ...MARKETING_LAYOUT_DEFINITION, variables } };
}

/** A design rendered for a caller that sends it, with the spec the send path renders again. */
export function withSpec(rendered: { subject: string; html: string }, spec: Omit<EmailSpec, "v" | "subject">): string {
  return embedSpec(rendered.html, { v: 1, subject: rendered.subject, ...spec });
}

/** Plain inline text (for code that builds a one-off document). */
export const text = inline;

export { escapeHtml };
