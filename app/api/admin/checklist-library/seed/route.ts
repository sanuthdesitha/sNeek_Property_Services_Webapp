import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { seedChecklistLibraryFromCatalog } from "@/lib/checklists/library";
import { db } from "@/lib/db";

/** Add missing standard items without overwriting existing authored content. */
export async function POST() {
  try {
    const session = await requireRole([Role.ADMIN]);
    const result = await seedChecklistLibraryFromCatalog();
    await db.auditLog.create({ data: { userId: session.user.id, action: "CHECKLIST_LIBRARY_SEED", entity: "ChecklistModule", entityId: "standard-library", after: result } });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === "UNAUTHORIZED" ? 401 : error.message === "FORBIDDEN" ? 403 : 400 });
  }
}
