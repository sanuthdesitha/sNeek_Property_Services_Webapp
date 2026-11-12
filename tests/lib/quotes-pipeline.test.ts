/**
 * Quotes and pricing list (2026-11): leads and quotes as one pipeline with
 * stage counts, server sort and paging, one next step per row, and a margin
 * that says Unknown rather than zero.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));

import { pagePipeline, parsePipelineFilters, pipelineCsv } from "@/lib/quotes/pipeline";
import { estimateMargin, pipelinePrimary, type PipelineRow } from "@/lib/quotes/pipeline-types";
import { parseListQuery } from "@/lib/admin/list-query";
import { PIPELINE_SORTS } from "@/lib/quotes/pipeline-types";

function row(partial: Partial<PipelineRow>): PipelineRow {
  return {
    kind: "quote", id: "q1", name: "Name", reference: "Q-1", serviceType: "AIRBNB_TURNOVER", suburb: null, total: 100, estimateMin: null, estimateMax: null,
    margin: 0.4, belowFloor: false, status: "DRAFT", stage: "quoted", frequency: null, clientId: null, leadId: null, email: null, phone: null,
    convertedJobId: null, hasQuote: true, updatedAt: "2026-11-10T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z", ...partial,
  };
}

const ROWS: PipelineRow[] = [
  row({ kind: "lead", id: "l1", name: "Olivia Grant", status: "NEW", stage: "new", total: null, updatedAt: "2026-11-12T00:00:00.000Z" }),
  row({ kind: "lead", id: "l2", name: "Mia Thompson", status: "CONTACTED", stage: "contacted", total: null, estimateMax: 95 }),
  row({ id: "q1", name: "Coastal Retreats", total: 1284, status: "DRAFT", stage: "quoted", frequency: "fortnightly" }),
  row({ id: "q2", name: "Daniel Wu", total: 640, status: "SENT", stage: "quoted" }),
  row({ id: "q3", name: "Harbour View", total: 420, status: "CONVERTED", stage: "won" }),
  row({ id: "q4", name: "Lost Co", total: 10, status: "DECLINED", stage: "lost" }),
];

const query = (params: Record<string, string> = {}) => parseListQuery(new URLSearchParams(params), { sortable: PIPELINE_SORTS, defaultSort: "updated", defaultDir: "desc" });

describe("pipeline paging", () => {
  it("counts every stage from the filtered rows and pages the chosen stage", () => {
    const page = pagePipeline(ROWS, parsePipelineFilters(new URLSearchParams("stage=open")), query({ pageSize: "2", sort: "value", dir: "desc" }));
    expect(page.counts).toEqual({ open: 4, new: 1, contacted: 1, quoted: 2, won: 1, lost: 1 });
    expect(page.total).toBe(4);
    expect(page.rows.map((r) => r.id)).toEqual(["q1", "q2"]);
  });

  it("filters by search, service and recurring, and refuses unknown stages and sorts", () => {
    expect(pagePipeline(ROWS, parsePipelineFilters(new URLSearchParams("stage=open&q=coastal")), query()).total).toBe(1);
    expect(pagePipeline(ROWS, parsePipelineFilters(new URLSearchParams("stage=open&recurring=1")), query()).rows.map((r) => r.id)).toEqual(["q1"]);
    expect(pagePipeline(ROWS, parsePipelineFilters(new URLSearchParams("stage=open&service=DEEP_CLEAN")), query()).total).toBe(0);
    expect(() => parsePipelineFilters(new URLSearchParams("stage=maybe"))).toThrow(/Unknown stage/);
    expect(() => query({ sort: "margin" })).toThrow(/Cannot sort/);
  });

  it("exports Unknown for a margin that cannot be worked out", () => {
    const csv = pipelineCsv([row({ margin: null })], parsePipelineFilters(new URLSearchParams("stage=quoted")));
    expect(csv.split("\n")[1]).toContain("Unknown");
  });
});

describe("next step and margin", () => {
  it("chooses one next step from the record's state", () => {
    expect(pipelinePrimary(ROWS[0])).toMatchObject({ kind: "link", label: "Make quote", href: "/v2/admin/quotes/new?leadId=l1" });
    expect(pipelinePrimary(ROWS[1])).toEqual({ kind: "counter", label: "Counter offer" });
    expect(pipelinePrimary(ROWS[2])).toEqual({ kind: "send", label: "Send" });
    expect(pipelinePrimary(ROWS[3])).toMatchObject({ label: "Follow up" });
    expect(pipelinePrimary(row({ status: "ACCEPTED" }))).toMatchObject({ label: "Book jobs" });
    expect(pipelinePrimary(row({ status: "CONVERTED", convertedJobId: "j9" }))).toMatchObject({ label: "Open job", href: "/v2/admin/jobs/j9" });
  });

  it("uses the margin-floor model and never reports zero for missing inputs", () => {
    const base = { positiveSubtotal: 100, netSubtotal: 100, rackHourlyRate: 60, cleanerHourlyCost: 36, marginFloorPercent: 35 };
    expect(estimateMargin(base).margin).toBeCloseTo(0.4);
    expect(estimateMargin({ ...base, marginFloorPercent: 45 }).belowFloor).toBe(true);
    expect(estimateMargin({ ...base, rackHourlyRate: 0 })).toEqual({ margin: null, belowFloor: false });
    expect(estimateMargin({ ...base, netSubtotal: 0 })).toEqual({ margin: null, belowFloor: false });
  });
});
