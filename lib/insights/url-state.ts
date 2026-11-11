/**
 * URL state of the Insights page: tab, period, client filter, and the active
 * table's sort / dir / page. The PDFs tab keeps its own filters (see
 * lib/reports/manager-query) beside these.
 *
 * Tab rule: an explicit valid `tab` wins; otherwise an old manager link
 * (hasLegacyReportParams) opens the PDFs tab; otherwise Business.
 *
 * Pure.
 */
import { hasLegacyReportParams } from "@/lib/reports/manager-query";
import { insightsPeriodQuery, resolveInsightsPeriodLenient, type InsightsPeriod } from "./period";
import { INSIGHTS_TABS, type InsightsTab } from "./types";

export type InsightsUrlState = {
  tab: InsightsTab;
  period: InsightsPeriod;
  clientId: string;
  sort: string;
  dir: "asc" | "desc" | "";
  page: number;
};

const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function resolveInsightsTab(params: URLSearchParams): InsightsTab {
  const raw = params.get("tab") ?? "";
  if ((INSIGHTS_TABS as readonly string[]).includes(raw)) return raw as InsightsTab;
  return hasLegacyReportParams(params) ? "pdfs" : "business";
}

export function readInsightsState(params: URLSearchParams, now: Date = new Date()): InsightsUrlState {
  const tab = resolveInsightsTab(params);
  const clientId = params.get("clientId") ?? "";
  const dir = params.get("dir");
  const page = Number(params.get("page"));
  const tableState = tab !== "pdfs";
  return {
    tab,
    period: resolveInsightsPeriodLenient({ period: params.get("period"), from: params.get("from"), to: params.get("to") }, now),
    clientId: CLIENT_ID.test(clientId) ? clientId : "",
    sort: tableState ? (params.get("sort") ?? "").slice(0, 32) : "",
    dir: tableState && (dir === "asc" || dir === "desc") ? dir : "",
    page: tableState && Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Writes the Insights state into `base`; the PDFs tab's own params are left alone. */
export function writeInsightsState(base: URLSearchParams, state: InsightsUrlState): URLSearchParams {
  const next = new URLSearchParams(base.toString());
  next.set("tab", state.tab);
  for (const key of ["period", "from", "to"]) next.delete(key);
  for (const [key, value] of Object.entries(insightsPeriodQuery(state.period))) next.set(key, value);
  if (state.clientId) next.set("clientId", state.clientId);
  else next.delete("clientId");
  if (state.tab !== "pdfs") {
    if (state.sort) next.set("sort", state.sort);
    else next.delete("sort");
    if (state.dir) next.set("dir", state.dir);
    else next.delete("dir");
    if (state.page > 1) next.set("page", String(state.page));
    else next.delete("page");
  }
  return next;
}

/** Period and client filter as an API query, plus optional extras. */
export function insightsApiQuery(state: Pick<InsightsUrlState, "period" | "clientId">, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(insightsPeriodQuery(state.period));
  if (state.clientId) params.set("clientId", state.clientId);
  for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
  return params.toString();
}
