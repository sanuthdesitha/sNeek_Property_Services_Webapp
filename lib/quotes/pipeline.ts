import "server-only";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { listResponse, ListQueryError, type ListQuery, type ListResponse } from "@/lib/admin/list-query";
import {
  PIPELINE_STAGES,
  estimateMargin,
  leadStage,
  quoteStage,
  shortQuoteRef,
  stageMatches,
  type PipelineCounts,
  type PipelineRow,
  type PipelineSort,
  type PipelineStage,
} from "./pipeline-types";

/**
 * The Quotes and pricing list: leads that have no quote yet, plus every quote,
 * filtered, counted per stage, sorted and paged on the server. Both tables are
 * small for this business (hundreds of rows), so they are read whole and merged
 * here; the screen only ever receives one page and real totals.
 */

export type PipelineFilters = { stage: PipelineStage; search: string; service: string | null; recurring: boolean };

const RECURRING = new Set(["weekly", "fortnightly", "monthly"]);

export function parsePipelineFilters(params: URLSearchParams): PipelineFilters {
  const rawStage = params.get("stage") ?? "open";
  if (!(PIPELINE_STAGES as readonly string[]).includes(rawStage)) {
    throw new ListQueryError(`Unknown stage "${rawStage}".`, "filter");
  }
  const service = params.get("service")?.trim() || null;
  if (service && !/^[A-Z_]{2,60}$/.test(service)) throw new ListQueryError("Unknown service.", "filter");
  return { stage: rawStage as PipelineStage, search: (params.get("q") ?? "").trim().toLowerCase().slice(0, 120), service, recurring: params.get("recurring") === "1" };
}

type LineItem = { total?: unknown };

function lineTotals(lineItems: unknown): { positive: number } {
  const lines = Array.isArray(lineItems) ? (lineItems as LineItem[]) : [];
  return { positive: lines.reduce((sum, line) => sum + Math.max(0, Number(line?.total ?? 0) || 0), 0) };
}

export async function loadPipelineRows(): Promise<PipelineRow[]> {
  const [leads, quotes, settings] = await Promise.all([
    db.quoteLead.findMany({
      where: { quotes: { none: {} } },
      select: { id: true, name: true, email: true, phone: true, suburb: true, serviceType: true, status: true, estimateMin: true, estimateMax: true, clientId: true, createdAt: true, updatedAt: true },
    }),
    db.quote.findMany({
      select: {
        id: true, status: true, serviceType: true, subtotal: true, totalAmount: true, lineItems: true, frequency: true, clientId: true, leadId: true,
        convertedJobId: true, serviceSuburb: true, createdAt: true, updatedAt: true,
        client: { select: { name: true, email: true, phone: true, suburb: true } },
        lead: { select: { name: true, email: true, phone: true, suburb: true } },
      },
    }),
    getAppSettings(),
  ]);
  const pricing = settings.pricing;

  const leadRows: PipelineRow[] = leads.map((lead) => ({
    kind: "lead",
    id: lead.id,
    name: lead.name,
    reference: `Lead${lead.suburb ? ` · ${lead.suburb}` : ""}`,
    serviceType: String(lead.serviceType),
    suburb: lead.suburb ?? null,
    total: null,
    estimateMin: lead.estimateMin ?? null,
    estimateMax: lead.estimateMax ?? null,
    margin: null,
    belowFloor: false,
    status: String(lead.status),
    stage: leadStage(String(lead.status)),
    frequency: null,
    clientId: lead.clientId ?? null,
    leadId: lead.id,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    convertedJobId: null,
    hasQuote: false,
    updatedAt: lead.updatedAt.toISOString(),
    createdAt: lead.createdAt.toISOString(),
  }));

  const quoteRows: PipelineRow[] = quotes.map((quote) => {
    const party = quote.client ?? quote.lead;
    const { margin, belowFloor } = estimateMargin({
      positiveSubtotal: lineTotals(quote.lineItems).positive,
      netSubtotal: Number(quote.subtotal ?? 0),
      rackHourlyRate: pricing.rackHourlyRate,
      cleanerHourlyCost: pricing.cleanerHourlyCost,
      marginFloorPercent: pricing.marginFloorPercent ?? 40,
    });
    return {
      kind: "quote",
      id: quote.id,
      name: party?.name ?? "Direct quote",
      reference: shortQuoteRef(quote.id),
      serviceType: String(quote.serviceType),
      suburb: quote.serviceSuburb ?? party?.suburb ?? null,
      total: Number(quote.totalAmount ?? 0),
      estimateMin: null,
      estimateMax: null,
      margin,
      belowFloor,
      status: String(quote.status),
      stage: quoteStage(String(quote.status)),
      frequency: quote.frequency ?? null,
      clientId: quote.clientId ?? null,
      leadId: quote.leadId ?? null,
      email: party?.email ?? null,
      phone: party?.phone ?? null,
      convertedJobId: quote.convertedJobId ?? null,
      hasQuote: true,
      updatedAt: quote.updatedAt.toISOString(),
      createdAt: quote.createdAt.toISOString(),
    };
  });

  return [...leadRows, ...quoteRows];
}

function compare(a: PipelineRow, b: PipelineRow, sort: PipelineSort): number {
  switch (sort) {
    case "enquiry":
      return a.name.localeCompare(b.name, "en-AU", { sensitivity: "base" });
    case "value":
      return (a.total ?? a.estimateMax ?? -1) - (b.total ?? b.estimateMax ?? -1);
    case "status":
      return a.status.localeCompare(b.status);
    default:
      return a.updatedAt.localeCompare(b.updatedAt);
  }
}

export function filterPipeline(rows: PipelineRow[], filters: Omit<PipelineFilters, "stage">): PipelineRow[] {
  return rows.filter((row) => {
    if (filters.service && row.serviceType !== filters.service) return false;
    if (filters.recurring && !RECURRING.has(String(row.frequency ?? "").toLowerCase())) return false;
    if (!filters.search) return true;
    return [row.name, row.reference, row.suburb, row.email, row.id].filter(Boolean).join(" ").toLowerCase().includes(filters.search);
  });
}

export function countStages(rows: PipelineRow[]): PipelineCounts {
  const counts = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, 0])) as PipelineCounts;
  for (const row of rows) {
    counts[row.stage] += 1;
    if (stageMatches(row.stage, "open")) counts.open += 1;
  }
  return counts;
}

export type PipelinePage = ListResponse<PipelineRow, PipelineSort> & { counts: PipelineCounts };

/** Filter, count, sort and page the merged rows. Pure; exported for tests. */
export function pagePipeline(rows: PipelineRow[], filters: PipelineFilters, query: ListQuery<PipelineSort>): PipelinePage {
  const matching = filterPipeline(rows, filters);
  const counts = countStages(matching);
  const inStage = matching.filter((row) => stageMatches(row.stage, filters.stage));
  const sorted = [...inStage].sort((a, b) => {
    const order = compare(a, b, query.sort);
    const tie = order !== 0 ? order : a.id.localeCompare(b.id);
    return query.dir === "asc" ? tie : -tie;
  });
  return { ...listResponse(sorted.slice(query.skip, query.skip + query.take), sorted.length, query), counts };
}

const CSV_LIMIT = 2000;

function csvCell(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The filtered list as CSV, capped at CSV_LIMIT rows (the cap is stated in the last line when hit). */
export function pipelineCsv(rows: PipelineRow[], filters: PipelineFilters): string {
  const matching = filterPipeline(rows, filters).filter((row) => stageMatches(row.stage, filters.stage));
  const header = ["Kind", "Reference", "Name", "Service", "Suburb", "Status", "Value", "Estimated margin %", "Below floor", "Email", "Updated"];
  const lines = matching.slice(0, CSV_LIMIT).map((row) =>
    [row.kind, row.reference, row.name, row.serviceType, row.suburb, row.status, row.total ?? "", row.margin == null ? "Unknown" : (row.margin * 100).toFixed(1), row.belowFloor ? "yes" : "", row.email, row.updatedAt].map((cell) => csvCell(cell as string | number | null)).join(","),
  );
  if (matching.length > CSV_LIMIT) lines.push(csvCell(`Only the first ${CSV_LIMIT} of ${matching.length} rows are included.`));
  return [header.join(","), ...lines].join("\n");
}
