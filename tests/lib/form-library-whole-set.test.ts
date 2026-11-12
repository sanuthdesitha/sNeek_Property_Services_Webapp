// @vitest-environment node
// Wave B library: Avg time / Completion sorted across the WHOLE filtered set
// ("–" last), refused beyond the read cap, and "never answered" folded into
// Checks as a warning so "Has problems" counts it.
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ templates: vi.fn(), drafts: vi.fn(), published: vi.fn(), properties: vi.fn(), count: vi.fn(), submissions: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", propertyFormTemplateOverrides: {} }) }));
vi.mock("@/lib/db", () => ({ db: {
  formTemplate: { findMany: m.templates },
  formTemplateVersion: { findMany: m.drafts, groupBy: m.published },
  property: { findMany: m.properties },
  formSubmission: { count: m.count, findMany: m.submissions },
} }));
import { listFormLibrary } from "@/lib/forms/library-list";
import { FIGURES_MAX_SUBMISSIONS } from "@/lib/forms/library-figures";
import { isListQueryError } from "@/lib/admin/list-query";

const now = new Date("2026-11-11T02:00:00Z");
const schema = { sections: [{ id: "k", title: "Kitchen", fields: [{ id: "oven", type: "yesno", label: "Oven", required: true }] }] };
const template = (id: string, name: string) => ({ id, name, serviceType: "AIRBNB_TURNOVER", kind: "CUSTOM", version: 1, isActive: true, archivedAt: null, publishedAt: now, createdAt: now, updatedAt: now, isJobScoped: false, schema, groupId: null, tags: [] });
function timed(templateId: string, minutes: number, count: number, answered = true) {
  return Array.from({ length: count }, (_, i) => ({
    templateId,
    createdAt: new Date(now.getTime() - (i + 1) * 3_600_000),
    data: { __startedAt: new Date(now.getTime() - (i + 1) * 3_600_000 - minutes * 60_000).toISOString(), ...(answered ? { oven: true } : {}) },
  }));
}
const filters = { scope: "active" as const, group: "", tag: "", status: "any" as const, usedBy: "any" as const, problems: false, q: "" };
const query = (sort: "avgTime" | "completion" | "name", dir: "asc" | "desc", take = 1) => ({ sort, dir, page: 1, pageSize: take, skip: 0, take });

beforeEach(() => {
  vi.resetAllMocks();
  m.templates.mockResolvedValue([template("a", "A"), template("b", "B"), template("c", "C"), template("d", "D")]);
  m.drafts.mockResolvedValue([]); m.published.mockResolvedValue([]); m.properties.mockResolvedValue([]);
  m.count.mockResolvedValue(60);
  m.submissions.mockResolvedValue([...timed("a", 30, 6), ...timed("b", 90, 6), ...timed("c", 60, 2), ...timed("d", 10, 25, false)]);
});

describe("whole-set figures", () => {
  it("sorts Avg time across pages, with '–' rows last in both directions", async () => {
    const desc = await listFormLibrary({ query: query("avgTime", "desc", 1) as never, filters, now });
    expect(desc.rows.map((r) => r.id)).toEqual(["b"]);
    const all = await listFormLibrary({ query: query("avgTime", "asc", 10) as never, filters, now });
    expect(all.rows.map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
    const allDesc = await listFormLibrary({ query: query("avgTime", "desc", 10) as never, filters, now });
    expect(allDesc.rows.map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
    expect(all.checksBasis).toBe("all");
  });
  it("folds never-answered into Checks as a warning and counts it in Has problems", async () => {
    const result = await listFormLibrary({ query: query("name", "asc", 10) as never, filters, now });
    const d = result.rows.find((r) => r.id === "d")!;
    expect(d.checks).toMatchObject({ status: "warnings", errors: 0, warnings: 1 });
    expect(d.checks.issues[0]).toMatchObject({ rule: "never-answered", severity: "warning", fieldId: "oven" });
    expect(result.counts.problems).toBe(1);
    const onlyProblems = await listFormLibrary({ query: query("name", "asc", 10) as never, filters: { ...filters, problems: true }, now });
    expect(onlyProblems.rows.map((r) => r.id)).toEqual(["d"]);
  });
  it("refuses a figure sort beyond the read cap, and falls back to page-only usage checks for other sorts", async () => {
    m.count.mockResolvedValue(FIGURES_MAX_SUBMISSIONS + 1);
    const refused = await listFormLibrary({ query: query("completion", "desc") as never, filters, now }).catch((error) => error);
    expect(isListQueryError(refused)).toBe(true);
    const byName = await listFormLibrary({ query: query("name", "asc", 10) as never, filters, now });
    expect(byName.checksBasis).toBe("page");
  });
});
