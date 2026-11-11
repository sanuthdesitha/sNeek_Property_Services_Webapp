import { describe, expect, it } from "vitest";
import { alwaysShownRequiredQuestions, summariseTemplateUsage, type SubmissionSample } from "@/lib/forms/submission-stats";
import { createUsageResolver, type UsageTemplate } from "@/lib/forms/library-usage";

const now = new Date("2026-11-11T02:00:00Z");
const schema = {
  sections: [
    {
      id: "k",
      title: "Kitchen",
      fields: [
        { id: "oven", type: "photo", label: "Oven", required: true },
        { id: "bins", type: "yesno", label: "Bins", required: true },
        { id: "opt", type: "text", label: "Optional" },
        { id: "cond", type: "text", label: "Conditional", required: true, conditional: { fieldId: "bins", value: false } },
        { id: "rot", type: "checkbox", label: "Rotation", required: true, frequency: "ROTATIONAL" },
        { id: "balcony-sweep", type: "checkbox", label: "Balcony swept", required: true },
      ],
    },
    { id: "c", title: "Only sometimes", conditional: { fieldId: "bins", value: true }, fields: [{ id: "x", type: "text", label: "X", required: true }] },
  ],
};

function sample(daysAgo: number, data: Record<string, unknown>): SubmissionSample {
  return { templateId: "t", createdAt: new Date(now.getTime() - daysAgo * 86_400_000), data };
}

describe("submission figures", () => {
  it("only counts required questions every submission must show", () => {
    expect(alwaysShownRequiredQuestions(schema).map((q) => q.id)).toEqual(["oven", "bins"]);
  });

  it("shows no figure (null, rendered as –) with too few submissions — never 0% or 100%", () => {
    const few = [1, 2, 3].map((d) => sample(d, { bins: true, uploads: { oven: ["a"] } }));
    const figures = summariseTemplateUsage({ schema, samples: few, now, liveSince: null });
    expect(figures).toMatchObject({ avgMinutes: null, completionPct: null, submissionsInWindow: 3, neverAnswered: [] });
  });

  it("averages time and completion with the stats-page definitions", () => {
    const started = (minutes: number, daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000 - minutes * 60_000).toISOString();
    const samples = [1, 2, 3, 4, 5, 6].map((d) => sample(d, { __startedAt: started(90, d), bins: true, uploads: d % 2 ? { oven: ["k"] } : {} }));
    const figures = summariseTemplateUsage({ schema, samples, now, liveSince: null });
    expect(figures.avgMinutes).toBe(90);
    expect(figures.completionPct).toBe(75);
  });

  it("flags a required question never answered only with enough submissions since the live version", () => {
    const samples = Array.from({ length: 25 }, (_, i) => sample(i + 1, { bins: true }));
    expect(summariseTemplateUsage({ schema, samples, now, liveSince: null }).neverAnswered.map((q) => q.id)).toEqual(["oven"]);
    const recentVersion = new Date(now.getTime() - 5 * 86_400_000);
    expect(summariseTemplateUsage({ schema, samples, now, liveSince: recentVersion }).neverAnswered).toEqual([]);
  });
});

describe("used by", () => {
  const base = { publishedAt: null, updatedAt: null, createdAt: null, archivedAt: null };
  const templates: UsageTemplate[] = [
    { ...base, id: "global-new", serviceType: "AIRBNB_TURNOVER", isActive: true, version: 3 },
    { ...base, id: "global-old", serviceType: "AIRBNB_TURNOVER", isActive: true, version: 1 },
    { ...base, id: "p3", serviceType: "AIRBNB_TURNOVER", isActive: true, version: 1 },
    { ...base, id: "job", serviceType: "AIRBNB_TURNOVER", isActive: true, version: 9, isJobScoped: true },
    { ...base, id: "draft", serviceType: "AIRBNB_TURNOVER", isActive: false, version: 4 },
  ];
  const resolve = createUsageResolver({
    overrides: { a: { AIRBNB_TURNOVER: "p3" }, gone: { AIRBNB_TURNOVER: "p3" }, b: { AIRBNB_TURNOVER: "draft" } },
    activePropertyIds: ["a", "b", "c"],
    templates,
  });

  it("resolves with the runtime order: override, then newest global", () => {
    // b's override points at an inactive form, so b falls back to the default.
    expect(resolve(templates[0])).toEqual({ kind: "default", properties: 2 });
    expect(resolve(templates[1])).toEqual({ kind: "unused" });
    expect(resolve(templates[2])).toEqual({ kind: "property", properties: 1 });
    expect(resolve(templates[3])).toEqual({ kind: "job" });
    expect(resolve(templates[4])).toEqual({ kind: "not-live" });
  });
});
