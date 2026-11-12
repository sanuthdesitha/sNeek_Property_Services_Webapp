/**
 * Request plumbing for /api/admin/insights/*: read the period and the client
 * filter strictly, and map errors to honest status codes.
 */
import { NextResponse } from "next/server";
import { isListQueryError, readQueryValue } from "@/lib/admin/list-query";
import type { InsightsFilters } from "./load-facts";
import { InsightsQueryError, isInsightsQueryError, resolveInsightsPeriod, type InsightsPeriod } from "./period";

export type InsightsQuery = { period: InsightsPeriod; filters: InsightsFilters };

const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function readInsightsQuery(params: URLSearchParams, now: Date = new Date()): InsightsQuery {
  const period = resolveInsightsPeriod(
    { period: readQueryValue(params, "period"), from: readQueryValue(params, "from"), to: readQueryValue(params, "to") },
    now,
  );
  const clientId = readQueryValue(params, "clientId") ?? "";
  if (clientId && !CLIENT_ID.test(clientId)) throw new InsightsQueryError("clientId is not a valid client.");
  return { period, filters: { clientId } };
}

export function insightsErrorResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error && error.message ? error.message : fallback;
  if (isInsightsQueryError(error) || isListQueryError(error)) {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
