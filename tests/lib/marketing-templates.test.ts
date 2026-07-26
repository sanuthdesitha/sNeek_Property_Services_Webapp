import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_TEMPLATES,
  TEMPLATE_CATEGORY_META,
  TEMPLATE_VARIABLE_TOKENS,
  extractTemplateTokens,
  getCampaignTemplate,
  getTemplatesByCategory,
  templateToDesign,
} from "@/lib/marketing/campaign-templates";
import { EMAIL_BLOCK_TYPES, parseEmailHtml, renderEmailHtml } from "@/lib/templates/email-blocks";
import { SEGMENTS } from "@/lib/marketing/segments";

const ALLOWED_TOKENS = new Set<string>(TEMPLATE_VARIABLE_TOKENS);
const BLOCK_TYPES = new Set(EMAIL_BLOCK_TYPES.map((entry) => entry.type));
const SEGMENT_IDS = new Set(SEGMENTS.map((segment) => segment.id));

describe("campaign template gallery", () => {
  it("ships a usable gallery (at least 12 templates, unique ids)", () => {
    expect(CAMPAIGN_TEMPLATES.length).toBeGreaterThanOrEqual(12);
    const ids = CAMPAIGN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CAMPAIGN_TEMPLATES.map((t) => [t.id, t] as const))("%s has every required field", (_id, template) => {
    expect(template.name.trim().length).toBeGreaterThan(0);
    expect(template.subject.trim().length).toBeGreaterThan(0);
    expect(template.previewText.trim().length).toBeGreaterThan(0);
    expect(template.goal.trim().length).toBeGreaterThan(0);
    expect(TEMPLATE_CATEGORY_META[template.category]).toBeTruthy();
    expect(["EMAIL", "SMS", "BOTH"]).toContain(template.channel);
    expect(Array.isArray(template.variables)).toBe(true);
    expect(template.blocks.length).toBeGreaterThan(0);
  });

  it.each(CAMPAIGN_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s renders through the block renderer without throwing",
    (_id, template) => {
      const design = templateToDesign(template);
      let html = "";
      expect(() => {
        html = renderEmailHtml(design);
      }).not.toThrow();
      expect(html).toContain("<table");
      // The design must round-trip out of the rendered HTML, because that is how
      // a saved campaign gets back into the block composer.
      const recovered = parseEmailHtml(html);
      expect(recovered.blocks).toHaveLength(template.blocks.length);
      expect(recovered.blocks.map((b) => b.type)).toEqual(template.blocks.map((b) => b.type));
    },
  );

  it.each(CAMPAIGN_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s only uses block types the registry supports, with unique block ids",
    (_id, template) => {
      for (const block of template.blocks) {
        expect(BLOCK_TYPES.has(block.type)).toBe(true);
        expect(block.id.trim().length).toBeGreaterThan(0);
      }
      const ids = template.blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it.each(CAMPAIGN_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s only uses variable tokens that actually resolve",
    (_id, template) => {
      const used = extractTemplateTokens(template);
      for (const token of used) {
        expect(ALLOWED_TOKENS.has(token), `unknown token {{${token}}} in ${template.id}`).toBe(true);
      }
      // The declared `variables` list must match what is really in the copy.
      expect(new Set(template.variables)).toEqual(new Set(used));
    },
  );

  it.each(CAMPAIGN_TEMPLATES.map((t) => [t.id, t] as const))(
    "%s points at a real segment and declares an SMS body when the channel needs one",
    (_id, template) => {
      expect(SEGMENT_IDS.has(template.suggestedAudience)).toBe(true);
      if (template.channel === "SMS" || template.channel === "BOTH") {
        expect(template.smsBody?.trim().length ?? 0).toBeGreaterThan(0);
        expect(template.smsBody!.length).toBeLessThanOrEqual(480);
      }
    },
  );

  it("has no lorem ipsum or unfilled placeholder copy in EMAIL-only templates", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      const body = template.blocks.map((b) => ("text" in b ? b.text : "")).join(" ");
      expect(body.toLowerCase()).not.toContain("lorem ipsum");
      expect(body.toLowerCase()).not.toContain("your message goes here");
    }
  });

  it("templates that keep [bracketed] fill-in slots say so in the body", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      const body = template.blocks.map((b) => ("text" in b ? b.text : "")).join(" ");
      if (/\[[A-Za-z][^\]]*\]/.test(body)) {
        expect(body).toContain("Before sending");
      }
    }
  });

  it("lookup helpers behave", () => {
    expect(getCampaignTemplate("spring-clean-promo")?.name).toBe("Spring clean promo");
    expect(getCampaignTemplate("does-not-exist")).toBeNull();
    expect(getTemplatesByCategory("seasonal").length).toBeGreaterThan(0);
    expect(getTemplatesByCategory("seasonal").every((t) => t.category === "seasonal")).toBe(true);
  });

  it("templateToDesign clones blocks so editing a draft never mutates the gallery", () => {
    const template = CAMPAIGN_TEMPLATES[0];
    const design = templateToDesign(template);
    (design.blocks[0] as any).text = "mutated";
    expect((template.blocks[0] as any).text).not.toBe("mutated");
  });
});
