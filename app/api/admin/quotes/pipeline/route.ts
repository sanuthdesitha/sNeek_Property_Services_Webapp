import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { loadPipelineRows, pagePipeline, parsePipelineFilters, pipelineCsv } from "@/lib/quotes/pipeline";
import { PIPELINE_SORTS } from "@/lib/quotes/pipeline-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/quotes/pipeline — leads and quotes as one list.
 * ?stage=open|new|contacted|quoted|won|lost &q= &service= &page= &pageSize= &sort=updated|enquiry|value|status &dir=
 * Returns { rows, total, page, pageSize, pageCount, sort, dir, counts }; an
 * unknown sort or stage is a 400. ?format=csv returns the filtered list as CSV
 * (capped), with the same roles.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message }, { status: message === "FORBIDDEN" ? 403 : 401 });
  }
  try {
    const params = new URL(req.url).searchParams;
    const filters = parsePipelineFilters(params);
    const query = parseListQuery(params, { sortable: PIPELINE_SORTS, defaultSort: "updated", defaultDir: "desc", defaultPageSize: 25 });
    const rows = await loadPipelineRows();
    if (params.get("format") === "csv") {
      return new NextResponse(pipelineCsv(rows, filters), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="quotes-${filters.stage}.csv"` },
      });
    }
    return NextResponse.json(pagePipeline(rows, filters, query));
  } catch (error) {
    if (isListQueryError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not load quotes." }, { status: 500 });
  }
}
