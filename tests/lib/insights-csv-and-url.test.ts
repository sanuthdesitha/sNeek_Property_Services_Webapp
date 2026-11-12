import { describe, expect, it } from "vitest";
import { summarise } from "@/lib/insights/aggregate";
import { businessCards } from "@/lib/insights/business";
import { businessCsv, csvCell, NOT_ENOUGH, propertiesCsv } from "@/lib/insights/csv";
import { deriveJobFact } from "@/lib/insights/job-facts";
import { MIN_BASIS_ROW, MIN_BASIS_SUMMARY } from "@/lib/insights/measure";
import { periodPayload, resolveInsightsPeriod } from "@/lib/insights/period";
import { readInsightsState, resolveInsightsTab, writeInsightsState } from "@/lib/insights/url-state";
import type { PropertyRow } from "@/lib/insights/entities";
import { hasLegacyReportParams, readReportFilters, writeReportFilters } from "@/lib/reports/manager-query";
import { context, jobRow } from "./insights-fixtures";

const NOW = new Date("2026-11-10T23:00:00Z");

function propertyRow(count: number, money: boolean): PropertyRow {
  const facts = Array.from({ length: count }, (_, index) => deriveJobFact(jobRow({ id: `j${index}`, timeLogs: index === 0 ? [] : jobRow().timeLogs }), context));
  return {
    id: "prop-1",
    propertyName: "Glebe House",
    clientId: "client-1",
    clientName: "Northside, Lets",
    figures: summarise(facts, { minBasis: MIN_BASIS_ROW, money, issues: 1 }),
    links: [],
  };
}

describe("CSV export", () => {
  it("writes real values, the basis and exclusions, and escapes text", () => {
    const csv = propertiesCsv([propertyRow(4, true)], true);
    const [header, line] = csv.trim().split("\r\n");
    // Revenue is invoiced amounts plus not-yet-invoiced scheduled charges (2026-11-11), with the split as columns.
    expect(header).toContain("Revenue (AUD, ex GST)");
    expect(header).toContain("Not yet invoiced (AUD, at current rates)");
    expect(header).toContain("Margin %");
    expect(line.startsWith('Glebe House,"Northside, Lets",4,')).toBe(true);
    expect(line).toContain("no time log (1)");
    expect(line).toContain(",600,");
  });

  it("writes Not enough data instead of a number, and leaves money out without finance", () => {
    const csv = propertiesCsv([propertyRow(2, false)], false);
    expect(csv.split("\r\n")[0]).not.toContain("Revenue");
    expect(csv).toContain(NOT_ENOUGH);
    expect(csv).not.toMatch(/,0,0,/);
  });

  it("business export lists each card with its basis and change", () => {
    const period = resolveInsightsPeriod({ period: "last-month" }, NOW);
    const facts = Array.from({ length: MIN_BASIS_SUMMARY }, (_, i) => deriveJobFact(jobRow({ id: `b${i}` }), context));
    const current = summarise(facts, { minBasis: MIN_BASIS_SUMMARY, money: true, issues: 0 });
    const csv = businessCsv({ cards: businessCards(current, null), period: periodPayload(period) });
    expect(csv).toContain("Figure,Value (October 2026)");
    expect(csv).toContain("\"Revenue (AUD, ex GST: invoiced + not yet invoiced at current rates)\",750,5,0");
    expect(csv).toContain("Gross margin %,40,5,0");
  });

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
  });
});

describe("URL state and the legacy report links", () => {
  it("opens the PDFs tab for an old manager link, keeping its filters", () => {
    const params = new URLSearchParams("q=glebe&propertyId=p1&visibility=client-hidden&sort=oldest&page=3");
    expect(resolveInsightsTab(params)).toBe("pdfs");
    expect(readReportFilters(params)).toEqual({ q: "glebe", propertyId: "p1", visibility: "client-hidden", sort: "oldest", page: 3 });
    expect(hasLegacyReportParams(new URLSearchParams("sort=service-date"))).toBe(true);
    // The Cases screen's "Open report" link.
    expect(resolveInsightsTab(new URLSearchParams("reportId=r1"))).toBe("pdfs");
  });

  it("does not treat page alone, or an Insights sort, as a manager link; an explicit tab wins", () => {
    expect(resolveInsightsTab(new URLSearchParams("page=2"))).toBe("business");
    expect(resolveInsightsTab(new URLSearchParams("sort=margin"))).toBe("business");
    expect(resolveInsightsTab(new URLSearchParams("tab=clients&q=glebe"))).toBe("clients");
    expect(resolveInsightsTab(new URLSearchParams(""))).toBe("business");
  });

  it("round-trips the Insights state and leaves the manager's params alone on the PDFs tab", () => {
    const state = readInsightsState(new URLSearchParams("tab=properties&period=custom&from=2026-10-01&to=2026-10-10&clientId=c1&sort=margin&dir=asc&page=2"), NOW);
    expect(state).toMatchObject({ tab: "properties", clientId: "c1", sort: "margin", dir: "asc", page: 2 });
    expect(writeInsightsState(new URLSearchParams(), state).toString()).toBe(
      "tab=properties&period=custom&from=2026-10-01&to=2026-10-10&clientId=c1&sort=margin&dir=asc&page=2",
    );
    const pdfs = readInsightsState(new URLSearchParams("q=x&sort=oldest&page=3"), NOW);
    const written = writeInsightsState(new URLSearchParams("q=x&sort=oldest&page=3"), pdfs);
    expect(written.get("sort")).toBe("oldest");
    expect(written.get("page")).toBe("3");
    expect(written.get("tab")).toBe("pdfs");
  });

  it("writes only non-default manager filters and refuses unknown values", () => {
    expect(writeReportFilters(new URLSearchParams("tab=pdfs"), { q: "", propertyId: "all", visibility: "all", sort: "newest", page: 1 }).toString()).toBe("tab=pdfs");
    expect(readReportFilters(new URLSearchParams("visibility=everyone&sort=random&page=-1"))).toMatchObject({ visibility: "all", sort: "newest", page: 1 });
  });
});
