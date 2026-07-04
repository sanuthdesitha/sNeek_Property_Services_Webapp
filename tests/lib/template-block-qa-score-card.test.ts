import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND_TOKENS } from "@/lib/brand/tokens";
import { qaScoreCardBlock } from "@/lib/templates/blocks/defs/qa-score-card";

function ctxFor(data: unknown) {
  return {
    channel: "pdf",
    brand: DEFAULT_BRAND_TOKENS,
    theme: {},
    data,
    merge: (s: string) => s,
    mergeText: (s: string) => s,
    color: (_r: string | undefined, f: string) => f,
    style: {},
  } as any;
}

describe("qaScoreCard block", () => {
  it("renders a passing verdict, score, and category bars", () => {
    const qa = {
      score: 93,
      passed: true,
      categories: [
        { label: "Kitchen", score: 96 },
        { label: "Bathroom", score: 80 },
      ],
      rework: null,
    };
    const props = qaScoreCardBlock.propsSchema.parse({ bind: "qa" });
    const html = qaScoreCardBlock.renderDocument!(props, ctxFor({ qa }));

    expect(html).toContain("tpl-qa-pass");
    expect(html).toContain("Passed");
    expect(html).toContain("93%");
    expect(html).toContain("Kitchen");
    expect(html).toContain("Bathroom");
    expect(html).toContain("width:96%");
    expect(html).toContain("width:80%");
  });

  it("renders a failing verdict with a rework panel", () => {
    const qa = {
      score: 60,
      passed: false,
      categories: [],
      rework: {
        required: true,
        severity: "MAJOR",
        areas: ["Shower glass"],
        note: "Streaks remain",
      },
    };
    const props = qaScoreCardBlock.propsSchema.parse({ bind: "qa" });
    const html = qaScoreCardBlock.renderDocument!(props, ctxFor({ qa }));

    expect(html).toContain("tpl-qa-fail");
    expect(html).toContain("Failed");
    expect(html).toContain("tpl-qa-rework");
    expect(html).toContain("MAJOR");
    expect(html).toContain("Shower glass");
    expect(html).toContain("Streaks remain");
  });

  it("renders a neutral verdict when passed is null and no score is present", () => {
    const qa = { score: null, passed: null };
    const props = qaScoreCardBlock.propsSchema.parse({ bind: "qa" });
    const html = qaScoreCardBlock.renderDocument!(props, ctxFor({ qa }));

    expect(html).toContain("Reviewed");
    expect(html).not.toContain("tpl-qa-score");
  });

  it("clamps a category score above 100 to a 100% bar", () => {
    const qa = {
      score: 100,
      passed: true,
      categories: [{ label: "Overkill", score: 130 }],
    };
    const props = qaScoreCardBlock.propsSchema.parse({ bind: "qa" });
    const html = qaScoreCardBlock.renderDocument!(props, ctxFor({ qa }));

    expect(html).toContain("width:100%");
  });
});
