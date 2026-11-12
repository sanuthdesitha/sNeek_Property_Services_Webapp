import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { isListQueryError } from "@/lib/admin/list-query";
import { buildClientDirectoryResponse, clientDirectoryCsv, filterClientRows, sortClientRows } from "@/lib/people/clients/derive";
import { loadClientDirectory } from "@/lib/people/clients/service";
import { parseClientDirectoryFilters, parseClientDirectoryQuery, type ClientDirectoryVisibility } from "@/lib/people/clients/types";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Client money on the list follows the rule before the redesign: everyone
 * admitted to Clients (ADMIN, OPS_MANAGER with the clients pack, which the
 * middleware enforces on /api/admin/clients) saw paid and outstanding figures.
 */
function visibilityFor(): ClientDirectoryVisibility {
  return { money: true };
}

/**
 * GET /api/admin/clients/directory — People › Clients: the client business
 * list, server filtered (`filter`, `q`), sorted (`sort`, `dir`) and paged
 * (`page`, `pageSize`), with chip counts and the header figures.
 * `format=csv` exports the filtered, sorted list (every page; `ids=a,b`
 * limits it to the selected clients).
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const visibility = visibilityFor();
    const filters = parseClientDirectoryFilters(params);
    const query = parseClientDirectoryQuery(params, visibility);
    const { rows, activeProperties } = await loadClientDirectory(visibility);
    if (params.get("format") === "csv") {
      const ids = new Set((params.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean));
      const chosen = ids.size > 0 ? rows.filter((row) => ids.has(row.id)) : filterClientRows(rows, filters);
      const stamp = new Date().toISOString().slice(0, 10);
      return new NextResponse(clientDirectoryCsv(sortClientRows(chosen, query.sort, query.dir), visibility), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="clients-${stamp}.csv"` },
      });
    }
    return NextResponse.json(buildClientDirectoryResponse(rows, filters, query, visibility, activeProperties), { headers });
  } catch (error) {
    if (isListQueryError(error)) return NextResponse.json({ error: error.message }, { status: 400, headers });
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401, headers });
    if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403, headers });
    return NextResponse.json({ error: "Could not load clients." }, { status: 500, headers });
  }
}
