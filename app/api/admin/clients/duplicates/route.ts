import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { findSimilarClients } from "@/lib/clients/create-client";
import { duplicateSentence } from "@/lib/clients/duplicate-rules";

const headers = { "Cache-Control": "private, no-store" };

/**
 * GET /api/admin/clients/duplicates?name=&email=&phone= — existing clients
 * that look like the one being added (same email, same company email domain,
 * same phone, similar name). Add client only warns; it never blocks.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = new URL(req.url).searchParams;
    const name = (params.get("name") ?? "").slice(0, 200);
    const email = (params.get("email") ?? "").slice(0, 200);
    const phone = (params.get("phone") ?? "").slice(0, 40);
    const matches = await findSimilarClients({ name, email, phone });
    return NextResponse.json({ matches: matches.map((match) => ({ id: match.id, name: match.name, propertyCount: match.propertyCount, isActive: match.isActive, reasons: match.reasons, sentence: duplicateSentence(match) })) }, { headers });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not check for similar clients." : err.message }, { status, headers });
  }
}
