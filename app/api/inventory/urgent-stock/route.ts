import { getAppSettings } from "@/lib/settings";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { isListQueryError, parseListQuery } from "@/lib/admin/list-query";
import { actOnUrgentStock, listUrgentStock, reportUrgentStock, setUrgentStockSettings } from "@/lib/inventory/urgent-stock";
import { listUrgentNeedsForOffice, parseUrgentFilters, URGENT_SORTS } from "@/lib/inventory/urgent-stock-list";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  if (isListQueryError(error)) return json({ error: error.message }, 400);
  const message = error instanceof Error ? error.message : "Could not save urgent stock.";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "NOT_FOUND" ? 404 : message.startsWith("CONFLICT") ? 409 : 400;
  return json({ error: message }, status);
}
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const params = req.nextUrl.searchParams;
    // All-property office list (administrators only, like every office action).
    // Without `paginated=1`, or with a propertyId, the response is unchanged.
    if (params.get("paginated") === "1" && !params.get("propertyId") && !params.get("reportId")) {
      const query = parseListQuery(params, { sortable: URGENT_SORTS, defaultSort: "neededBy", defaultDir: "asc", defaultPageSize: 25, maxPageSize: 100 });
      return json(await listUrgentNeedsForOffice(session.user, parseUrgentFilters(params), query));
    }
    return json({ ...await listUrgentStock(session.user, params.get("propertyId") || undefined, params.get("reportId") || undefined), timeZone: (await getAppSettings()).timezone });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
  if (!["http", "https"].includes(protocol) || req.headers.get("origin") !== `${protocol}://${host}`) return json({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    const { action, ...input } = await req.json();
    if (action === "report") return json(await reportUrgentStock(session.user, input));
    if (action === "transition") return json(await actOnUrgentStock(session.user, input));
    if (action === "settings") return json(await setUrgentStockSettings(session.user, input));
    return json({ error: "Unknown action." }, 400);
  } catch (error) { return failure(error); }
}
