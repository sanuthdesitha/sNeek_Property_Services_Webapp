import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { readRequiredDocuments, saveRequiredDocuments } from "@/lib/accounts/required-documents-store";

export const dynamic = "force-dynamic";

function failure(err: unknown) {
  if (err instanceof ZodError) return NextResponse.json({ error: err.issues[0]?.message ?? "Invalid setting." }, { status: 400 });
  const message = err instanceof Error ? err.message : "";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: message }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: message }, { status: 403 });
  return NextResponse.json({ error: "Could not save the required documents." }, { status: 500 });
}

/** GET — required document types per role (office roles: it drives the Accounts list). */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await readRequiredDocuments());
  } catch (err) {
    return failure(err);
  }
}

/** PUT { byRole } — administrators only, audited. */
export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const saved = await saveRequiredDocuments({ id: session.user.id, role: session.user.role }, await req.json().catch(() => null));
    return NextResponse.json({ ...saved, readable: true });
  } catch (err) {
    return failure(err);
  }
}
