import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { listStayPreparation, saveStayPolicy } from "@/lib/inventory/stay-preparation";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not save stay preparation.";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "NOT_FOUND" ? 404 : message.startsWith("CONFLICT") ? 409 : 400;
  return json({ error: message }, status);
}
export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    return json(await listStayPreparation(session.user, req.nextUrl.searchParams.get("propertyId") || "", req.nextUrl.searchParams.get("jobId") || undefined));
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || req.nextUrl.host;
  const protocol = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || req.nextUrl.protocol.replace(":", "");
  if (!["http", "https"].includes(protocol) || req.headers.get("origin") !== `${protocol}://${host}`) return json({ error: "Same-origin request required." }, 403);
  try {
    const session = await requireSession();
    const { propertyId, policy } = await req.json();
    if (typeof propertyId !== "string" || !propertyId) return json({ error: "Property required." }, 400);
    return json(await saveStayPolicy(session.user, propertyId, policy));
  } catch (error) { return failure(error); }
}
