import { NextRequest, NextResponse } from "next/server";
import { readQueryValue } from "@/lib/admin/list-query";
import { requireInsightsAccess } from "@/lib/insights/access";
import { getBusinessInsights } from "@/lib/insights/business";
import { businessCsv, cleanersCsv, clientsCsv, jobTypesCsv, propertiesCsv } from "@/lib/insights/csv";
import {
  getTimeCostInsights,
  sortedCleanerRows,
  sortedClientRows,
  sortedPropertyRows,
} from "@/lib/insights/entity-service";
import { insightsErrorResponse, readInsightsQuery } from "@/lib/insights/http";
import { InsightsQueryError } from "@/lib/insights/period";
import { EXPORTABLE_TABS, type ExportableTab } from "@/lib/insights/types";

export const dynamic = "force-dynamic";

function readTab(params: URLSearchParams): ExportableTab {
  const tab = readQueryValue(params, "tab") ?? "business";
  if (!(EXPORTABLE_TABS as readonly string[]).includes(tab)) {
    throw new InsightsQueryError(`Cannot export "${tab}". Exportable tabs: ${EXPORTABLE_TABS.join(", ")}.`);
  }
  return tab as ExportableTab;
}

/**
 * CSV of the current tab's table for the period, client filter and sort on
 * screen (every row, not one page). Financial columns follow the same access
 * rule as the API: absent without the finance feature.
 */
export async function GET(req: NextRequest) {
  try {
    const access = await requireInsightsAccess();
    const now = new Date();
    const params = req.nextUrl.searchParams;
    const tab = readTab(params);
    const { period, filters } = readInsightsQuery(params, now);

    let csv: string;
    if (tab === "business") {
      csv = businessCsv(await getBusinessInsights(period, filters, access, now));
    } else if (tab === "properties") {
      csv = propertiesCsv((await sortedPropertyRows(period, filters, access, params)).rows, access.finance);
    } else if (tab === "clients") {
      csv = clientsCsv((await sortedClientRows(period, filters, access, params, now)).rows, access.finance);
    } else if (tab === "cleaners") {
      csv = cleanersCsv((await sortedCleanerRows(period, filters, params)).rows);
    } else {
      csv = jobTypesCsv((await getTimeCostInsights(period, filters, access)).byJobType, access.finance);
    }

    const name = `insights-${tab}-${period.fromKey}-to-${period.toKey}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return insightsErrorResponse(error, "Could not export the Insights table.");
  }
}
