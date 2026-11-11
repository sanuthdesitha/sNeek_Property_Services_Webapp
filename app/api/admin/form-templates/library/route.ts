import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { listFormLibrary, parseFormLibraryFilters } from "@/lib/forms/library-list";
import { FORM_LIBRARY_SORTS } from "@/lib/forms/library-types";

/**
 * GET /api/admin/form-templates/library — the forms library list.
 * Server paging and sorting through lib/admin/list-query (unknown sort or bad
 * paging → 400) plus filters: scope, group, tag, status, usedBy, problems, q.
 * Returns { rows, total, page, pageSize, pageCount, sort, dir, counts, statsBasis }.
 * Read access matches the template list: ADMIN and OPS_MANAGER.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params, {
      sortable: FORM_LIBRARY_SORTS,
      defaultSort: "name",
      defaultDir: "asc",
      defaultPageSize: 25,
      maxPageSize: 100,
    });
    const filters = parseFormLibraryFilters(params);
    return NextResponse.json(await listFormLibrary({ query, filters }));
  } catch (err: unknown) {
    const message = err instanceof Error && err.message ? err.message : "Could not load forms.";
    const status = isListQueryError(err) ? 400 : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
