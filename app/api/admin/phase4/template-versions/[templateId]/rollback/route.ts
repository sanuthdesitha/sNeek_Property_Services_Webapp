import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { LEGACY_TEMPLATE_VERSION_WRITES_GONE } from "@/lib/phase4/template-versions";

/**
 * Old rollback (switched `isActive` between sibling templates, changing which
 * form jobs resolve to, with no screen). Refuses with 410 and points to the
 * Forms library's version history and restore-as-draft.
 */
export async function POST() {
  try {
    await requireRole([Role.ADMIN]);
    return NextResponse.json({ error: LEGACY_TEMPLATE_VERSION_WRITES_GONE, gone: true }, { status: 410 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Request failed." : message }, { status });
  }
}
