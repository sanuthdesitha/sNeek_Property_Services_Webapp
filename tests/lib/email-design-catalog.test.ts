// @vitest-environment node
/**
 * Every email moved onto the block layout keeps the facts and values it had
 * (version 1 = the current wording), passes its own checks, and keeps its
 * locked content. Plus the contrast check of the Email look.
 */
import { describe, expect, it } from "vitest";
import { getDefaultEmailTemplates, renderEmailTemplate, type AppEmailTemplateKey } from "@/lib/email-templates";
import { EMAIL_DESIGNS, emailDesign } from "@/lib/email-design/registry";
import { blockingChecks, checkDocument, documentValues } from "@/lib/email-design/checks";
import { businessFromSettings, composeDesign } from "@/lib/email-design/compose";
import { checkBrandColour, COLOUR_PRESETS, DEFAULT_EMAIL_THEME, themeContrastReport, themeProblems } from "@/lib/email-design/theme";
import { extractSpec } from "@/lib/email-design/spec";

/** Placeholders the old shared templates used that are styling or common, not facts. */
const NOT_FACTS = new Set(["companyName"]);
/** Values that changed on purpose (owner defaults 2026-11-16), with the reason. */
const CHANGED: Record<string, Record<string, string>> = {
  resetPassword: { tempPassword: "admin reset sends a one-time link instead of a temporary password", userName: "kept", email: "kept" },
  signupOtp: {},
};

const settings = { companyName: "sNeek Property Services", logoUrl: "", emailTemplates: getDefaultEmailTemplates(), invoicing: { abn: "41 623 904 118", companyAddress: "Suite 4" } };

function oldPlaceholders(key: AppEmailTemplateKey): string[] {
  const template = getDefaultEmailTemplates()[key];
  return Array.from(new Set(`${template.subject} ${template.html}`.match(/\{([a-zA-Z0-9_]+)\}/g)?.map((token) => token.slice(1, -1)) ?? []));
}

describe("every shared template is a block design that keeps its facts", () => {
  const templateDesigns = EMAIL_DESIGNS.filter((definition) => definition.templateKey);

  it("covers all 30 shared templates", () => {
    expect(templateDesigns.map((definition) => definition.templateKey).sort()).toEqual([...Object.keys(getDefaultEmailTemplates())].sort());
  });

  it.each(templateDesigns.map((definition) => [definition.key, definition] as const))("%s uses every value its old template used", (key, definition) => {
    const used = documentValues(definition.defaults);
    const missing = oldPlaceholders(key as AppEmailTemplateKey).filter((name) => !NOT_FACTS.has(name) && !used.includes(name) && !(CHANGED[key]?.[name]));
    expect(missing).toEqual([]);
  });

  it.each(templateDesigns.map((definition) => [definition.key] as const))("%s renders its sample facts through renderEmailTemplate", (key) => {
    const definition = emailDesign(key)!;
    const values = definition.samples[0].values;
    const rendered = renderEmailTemplate(settings, key as AppEmailTemplateKey, values);
    const { spec, html } = extractSpec(rendered.html);
    expect(spec?.kind).toBe("design");
    expect(spec?.key).toBe(key);
    for (const name of documentValues(definition.defaults)) {
      const variable = definition.variables.find((item) => item.name === name);
      const sample = values[name];
      if (!sample || !variable || ["url", "built", "rows", "photos", "code"].includes(variable.format ?? "text") || name === "actionLabel") continue;
      const escaped = sample.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#39;");
      expect(html.includes(escaped) || rendered.subject.includes(sample)).toBe(true);
    }
  });
});

describe("every design", () => {
  it.each(EMAIL_DESIGNS.map((definition) => [definition.key, definition] as const))("%s: version 1 passes its own checks and renders without missing values", (_key, definition) => {
    expect(blockingChecks(checkDocument(definition, definition.defaults, DEFAULT_EMAIL_THEME))).toEqual([]);
    const rendered = composeDesign(definition, definition.defaults, definition.samples[0].values, { theme: DEFAULT_EMAIL_THEME, business: businessFromSettings(settings), appUrl: "https://app.example.invalid", mode: "send", settings });
    expect(rendered.missing).toEqual([]);
    expect(rendered.text.length).toBeGreaterThan(40);
    expect(rendered.subject.length).toBeGreaterThan(5);
  });

  it("only allows inserted values from each type's allowlist", () => {
    for (const definition of EMAIL_DESIGNS) {
      const allowed = new Set(definition.variables.map((variable) => variable.name));
      expect(documentValues(definition.defaults).filter((name) => !allowed.has(name))).toEqual([]);
    }
  });
});

describe("locked content", () => {
  it("refuses a security email whose fixed words were changed or whose code was removed", () => {
    const definition = emailDesign("twoFactorSignInCode")!;
    const withoutCode = { ...definition.defaults, blocks: definition.defaults.blocks.filter((block) => block.type !== "code") };
    expect(blockingChecks(checkDocument(definition, withoutCode)).map((check) => check.id)).toEqual(expect.arrayContaining(["locked", "security-fixed"]));
    const reworded = { ...definition.defaults, blocks: definition.defaults.blocks.map((block) => (block.type === "heading" ? { ...block, text: [{ kind: "text" as const, text: "Hello" }] } : block)) };
    expect(blockingChecks(checkDocument(definition, reworded)).map((check) => check.id)).toContain("locked");
  });

  it("refuses removing a required block or a kept value (invoice number, reset link)", () => {
    const invoice = emailDesign("clientInvoiceIssued")!;
    const noDetails = { ...invoice.defaults, blocks: invoice.defaults.blocks.filter((block) => block.type !== "details") };
    expect(blockingChecks(checkDocument(invoice, noDetails)).map((check) => check.id)).toEqual(expect.arrayContaining(["locked", "required-values"]));
    const reset = emailDesign("resetPassword")!;
    const noLink = { ...reset.defaults, blocks: reset.defaults.blocks.filter((block) => block.type !== "button") };
    expect(blockingChecks(checkDocument(reset, noLink)).length).toBeGreaterThan(0);
  });

  it("refuses a second button and a block the type does not allow", () => {
    const reminder = emailDesign("jobReminder24h")!;
    const twoButtons = { ...reminder.defaults, blocks: [...reminder.defaults.blocks, { id: "n1", type: "button" as const, label: "Again", link: "jobUrl" }] };
    expect(blockingChecks(checkDocument(reminder, twoButtons)).map((check) => check.id)).toContain("button");
    const code = { ...reminder.defaults, blocks: [...reminder.defaults.blocks, { id: "n2", type: "code" as const, source: "jobNumber" }] };
    expect(blockingChecks(checkDocument(reminder, code)).map((check) => check.id)).toContain("blocks-allowed");
  });

  it("the sign-in code is never in the subject (owner default)", () => {
    for (const key of ["twoFactorSignInCode", "signupOtp", "twoFactorConfirmCode"]) {
      const definition = emailDesign(key)!;
      const rendered = composeDesign(definition, definition.defaults, definition.samples[0].values, { theme: DEFAULT_EMAIL_THEME, business: businessFromSettings(settings), appUrl: "https://app.example.invalid", mode: "send", settings });
      expect(rendered.subject).not.toContain(definition.samples[0].values.code);
      expect(rendered.html).toContain("482 913");
    }
  });
});

describe("Email look contrast", () => {
  it("every preset carries button text at 4.5:1 and every derived colour passes in light and dark", () => {
    for (const preset of COLOUR_PRESETS) {
      expect(checkBrandColour(preset.color).ok).toBe(true);
      expect(themeContrastReport({ ...DEFAULT_EMAIL_THEME, preset: preset.id, brandColor: preset.color }).every((row) => row.ok)).toBe(true);
    }
  });

  it("refuses a custom colour that fails and suggests the nearest shade that passes", () => {
    const check = checkBrandColour("#7FB89A");
    expect(check.ok).toBe(false);
    expect(check.ratio).toBeLessThan(4.5);
    expect(check.suggestion).toMatch(/^#[0-9A-F]{6}$/);
    expect(checkBrandColour(check.suggestion!).ok).toBe(true);
    expect(themeProblems({ ...DEFAULT_EMAIL_THEME, preset: "custom", brandColor: "#7FB89A" }).map((problem) => problem.field)).toContain("brandColor");
    expect(themeProblems({ ...DEFAULT_EMAIL_THEME, preset: "custom", brandColor: check.suggestion! })).toEqual([]);
  });

  it("defaults to the Estate deep green", () => {
    expect(DEFAULT_EMAIL_THEME.brandColor).toBe("#1E4A38");
  });
});
