// @vitest-environment node
/**
 * The one email renderer (email design system, 2026-11-16): escaping, every
 * block, the plain-text part, the Outlook-safe structure, the dark palette and
 * missing values (placeholder in preview, refusal list at send).
 */
import { describe, expect, it } from "vitest";
import { inline } from "@/lib/email-design/inline";
import { renderEmailDocument, type RenderOptions } from "@/lib/email-design/render";
import { DEFAULT_EMAIL_THEME, darkPalette, lightPalette } from "@/lib/email-design/theme";
import type { EmailDocument, EmailVariable } from "@/lib/email-design/types";

const VARIABLES: EmailVariable[] = [
  { name: "name", label: "Name", sample: "Jane", fallback: "there" },
  { name: "property", label: "Property", sample: "The Bondi Studio", required: true },
  { name: "link", label: "Link", sample: "", format: "url" },
  { name: "code", label: "Code", sample: "", format: "code" },
  { name: "note", label: "Note", sample: "" },
  { name: "lines", label: "Lines", sample: "", format: "rows" },
  { name: "list", label: "List", sample: "", format: "built", textTwin: "listText" },
  { name: "listText", label: "List text", sample: "" },
  { name: "photos", label: "Photos", sample: "", format: "photos" },
];

const options = (overrides: Partial<RenderOptions> = {}): RenderOptions => ({
  theme: DEFAULT_EMAIL_THEME,
  business: { companyName: "sNeek Property Services", abn: "41 623 904 118", address: "Suite 4, 88 Foveaux St, Surry Hills NSW 2010", phone: "02 8005 4410", contactEmail: "office@example.invalid", logoUrl: "", logoDarkUrl: "" },
  definition: { key: "test", variables: VARIABLES, whyLine: "You got this because you're the main contact.", preferences: "client", security: false },
  mode: "send",
  preferencesUrl: "https://app.example.invalid/v2/client/settings",
  ...overrides,
});

const DOC: EmailDocument = {
  subject: inline("Your clean at {{property}} is done"),
  preheader: inline("Guest-ready for 3:00 pm."),
  reference: "property",
  blocks: [
    { id: "b1", type: "heading", text: inline("Your clean at {{property}} is done") },
    { id: "b2", type: "paragraph", text: inline("Hi {{name}}, **Jane** finished.") },
    { id: "b3", type: "details", rows: [{ id: "r1", label: "Property", value: inline("{{property}}") }, { id: "r2", label: "Note", value: inline("{{note}}") }] },
    { id: "b4", type: "lineItems", source: "lines" },
    { id: "b5", type: "button", label: "View the report", link: "link" },
    { id: "b6", type: "callout", tone: "action", text: inline("approve by 5:00 pm.") },
    { id: "b7", type: "photos", source: "photos", caption: inline("4 of 18 photos.") },
    { id: "b8", type: "code", source: "code" },
    { id: "b9", type: "signature", name: inline("Hannah Lee"), role: inline("Operations") },
    { id: "b10", type: "divider" },
    { id: "b11", type: "note", text: inline("Questions? Reply to this email.") },
    { id: "b12", type: "lineItems", source: "list" },
  ],
};

const FULL = {
  name: "Priya",
  property: "The Bondi Studio",
  link: "https://app.example.invalid/r/J-1042",
  code: "482913",
  note: "Fan is noisy",
  lines: JSON.stringify({ rows: [{ label: "Turnover", value: "$165.00" }, { label: "GST", value: "$16.50", kind: "sub" }, { label: "Total", value: "$181.50", kind: "total" }] }),
  list: "<ol><li>8:30 am · Glebe House</li></ol>",
  listText: "8:30 am Glebe House",
  photos: JSON.stringify([{ url: "https://img.example.invalid/1.jpg", caption: "Living · 1:41 pm" }]),
};

describe("escaping", () => {
  it("escapes every value, in text and attributes, and refuses unsafe links", () => {
    const hostile = { ...FULL, name: '<img src=x onerror="alert(1)">', property: 'A&B "Loft" <b>', link: 'javascript:alert(1)' };
    const rendered = renderEmailDocument(DOC, hostile, options());
    expect(rendered.html).not.toContain('<img src=x onerror="alert(1)">');
    expect(rendered.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(rendered.html).toContain("A&amp;B &quot;Loft&quot; &lt;b&gt;");
    expect(rendered.html).not.toContain("javascript:");
    // A typed "{{" in stored text stays text; it is never a value.
    const typed = renderEmailDocument({ ...DOC, blocks: [{ id: "b1", type: "heading", text: [{ kind: "text", text: "{{property}} <script>" }] }] }, FULL, options());
    expect(typed.html).toContain("{{property}} &lt;script&gt;");
  });

  it("passes built fragments through as built (code-escaped) content only", () => {
    const rendered = renderEmailDocument(DOC, FULL, options());
    expect(rendered.html).toContain("<ol><li>8:30 am · Glebe House</li></ol>");
    expect(rendered.text).toContain("8:30 am Glebe House");
  });
});

describe("blocks", () => {
  it("renders each of the twelve parts with its facts", () => {
    const { html } = renderEmailDocument(DOC, FULL, options());
    expect(html).toContain("<h1");
    expect(html).toContain("<strong");
    expect(html).toContain("Fan is noisy");
    expect(html).toContain("$181.50");
    expect(html).toContain("View the report");
    expect(html).toContain("Action needed:");
    expect(html).toContain("https://img.example.invalid/1.jpg");
    expect(html).toContain("482 913");
    expect(html).toContain("Hannah Lee");
    expect(html).toContain("Questions? Reply to this email.");
    expect(html).toContain("ABN 41 623 904 118");
    expect(html).toContain("You got this because you&#39;re the main contact.");
    expect(html).toContain("Email preferences");
  });

  it("hides an optional row whose value is empty and never shows 0 or a blank", () => {
    const { html } = renderEmailDocument(DOC, { ...FULL, note: "" }, options());
    expect(html).not.toContain(">Note<");
    expect(html).toContain(">Property<");
  });

  it("uses the fallback for an empty optional value inside a sentence", () => {
    const { html } = renderEmailDocument(DOC, { ...FULL, name: "" }, options());
    expect(html).toContain("Hi there,");
  });

  it("security emails have no preferences link and say they can't be turned off", () => {
    const { html, text } = renderEmailDocument(DOC, FULL, options({ definition: { ...options().definition, security: true } }));
    expect(html).not.toContain("Email preferences");
    expect(html).toContain("Security emails can&#39;t be turned off.");
    expect(text).toContain("Security emails can't be turned off.");
  });
});

describe("plain-text part", () => {
  it("is generated from the same blocks: title in capitals, button as label and link, callout word in capitals, aligned details", () => {
    const { text } = renderEmailDocument(DOC, FULL, options());
    expect(text).toContain("YOUR CLEAN AT THE BONDI STUDIO IS DONE");
    expect(text).toContain("View the report:\nhttps://app.example.invalid/r/J-1042");
    expect(text).toContain("ACTION NEEDED: approve by 5:00 pm.");
    expect(text).toMatch(/Property {2,}The Bondi Studio/);
    expect(text).toContain("482 913");
    expect(text).toContain("Email preferences: https://app.example.invalid/v2/client/settings");
    expect(text).not.toMatch(/<[a-z]/i);
  });
});

describe("Outlook-safe structure", () => {
  it("uses tables with a 600 attribute, a VML button and inline styles; no flex, grid or CSS variables", () => {
    const { html } = renderEmailDocument(DOC, FULL, options());
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('lang="en-AU"');
    expect(html).toContain('width="600"');
    expect(html).toContain("<v:roundrect");
    expect(html).toContain("<!--[if mso]>");
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).not.toContain("var(--");
    expect(html).toMatch(/<img [^>]*alt="Living · 1:41 pm"/);
  });
});

describe("dark palette", () => {
  it("ships a prefers-color-scheme stylesheet from the derived palette, and inlines it when forced dark", () => {
    const dark = darkPalette(DEFAULT_EMAIL_THEME);
    const auto = renderEmailDocument(DOC, FULL, options());
    expect(auto.html).toContain("@media (prefers-color-scheme: dark)");
    expect(auto.html).toContain(`.sn-card{background:${dark.card}!important`);
    expect(auto.html).toContain("[data-ogsc]");
    const forced = renderEmailDocument(DOC, FULL, options({ scheme: "dark" }));
    expect(forced.html).toContain(`background:${dark.page}`);
    expect(forced.html).not.toContain(`background:${lightPalette(DEFAULT_EMAIL_THEME).page}`);
  });
});

describe("missing values", () => {
  it("lists an empty required value (the send path refuses it) and renders no blank", () => {
    const rendered = renderEmailDocument(DOC, { ...FULL, property: "" }, options());
    expect(rendered.missing).toEqual(["Property"]);
    expect(rendered.html).not.toContain("[Property missing]");
  });

  it("shows a visible placeholder in preview instead of a blank", () => {
    const rendered = renderEmailDocument(DOC, { ...FULL, property: "" }, options({ mode: "preview" }));
    expect(rendered.html).toContain("[Property missing]");
    expect(rendered.missing).toEqual(["Property"]);
  });
});
