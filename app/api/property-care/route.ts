import { ensureClientModuleAccess } from "@/lib/portal-access";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { careWorkspace, configureCare, createCareSpecial, planPropertyCare } from "@/lib/property-care/service";
export const dynamic = "force-dynamic";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) { const message = error instanceof Error ? error.message : "Property care request failed"; return response({ error: message }, message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "NOT_FOUND" ? 404 : message.startsWith("CONFLICT") ? 409 : 400); }
export async function GET(req: NextRequest) { try { const session = await requireRole(["ADMIN", "OPS_MANAGER", "CLIENT"]); if (session.user.role === "CLIENT") await ensureClientModuleAccess("properties"); return response(await careWorkspace(session.user.id, req.nextUrl.searchParams.get("propertyId") || "")); } catch (error) { return failure(error); } }
export async function POST(req: NextRequest) {
 const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || req.nextUrl.host;
 const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || req.nextUrl.protocol.replace(":", "");
 if (!["http", "https"].includes(protocol) || req.headers.get("origin") !== `${protocol}://${host}`) return response({ error: "Same-origin request required" }, 403);
 try { const session = await requireRole(["ADMIN", "OPS_MANAGER"]); const { action, propertyId, ...input } = await req.json();
  if (action === "configure") return response(await configureCare(session.user.id, propertyId, input));
  if (action === "special") return response(await createCareSpecial(session.user.id, propertyId, input));
  if (action === "plan") return response(await planPropertyCare(propertyId, session.user.id));
  return response({ error: "Unknown action" }, 400);
 } catch (error) { return failure(error); }
}
