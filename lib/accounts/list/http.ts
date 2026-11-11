/**
 * HTTP side of the paginated Accounts list and its export. The caller has
 * already passed `requireRole([ADMIN, OPS_MANAGER])`; this resolves what the
 * viewer may see and refuses a malformed query with 400.
 */
import "server-only";
import { NextResponse } from "next/server";
import { isListQueryError } from "@/lib/admin/list-query";
import { resolveAccountsViewer } from "@/lib/accounts/viewer";
import { accountsCsv } from "./csv";
import { buildListResponse, filterRows, sortRows } from "./derive";
import { loadAccountRows } from "./service";
import { parseAccountFilters, parseAccountListQuery } from "./types";

type SessionUser = Parameters<typeof resolveAccountsViewer>[0];

export function accountListError(error: unknown, fallback: string): NextResponse {
  if (isListQueryError(error)) return NextResponse.json({ error: error.message }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function accountListResponse(user: SessionUser, params: URLSearchParams): Promise<NextResponse> {
  const viewer = await resolveAccountsViewer(user);
  const filters = parseAccountFilters(params);
  const query = parseAccountListQuery(params, viewer.visibility);
  const rows = await loadAccountRows(viewer.visibility);
  return NextResponse.json(buildListResponse(rows, filters, query, viewer.visibility));
}

export async function accountExportResponse(user: SessionUser, params: URLSearchParams): Promise<NextResponse> {
  const viewer = await resolveAccountsViewer(user);
  const filters = parseAccountFilters(params);
  const query = parseAccountListQuery(params, viewer.visibility);
  const rows = sortRows(filterRows(await loadAccountRows(viewer.visibility), filters), query.sort, query.dir);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(accountsCsv(rows, viewer.visibility), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accounts-${filters.tab}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
