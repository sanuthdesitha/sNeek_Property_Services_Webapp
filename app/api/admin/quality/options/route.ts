import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { hubErrorResponse } from "@/lib/quality/http";
import { loadQualityOptions } from "@/lib/quality/issue-list";

export const dynamic = "force-dynamic";

/** Filter options for the hub, read from the database rather than loaded rows. */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.QA_INSPECTOR]);
    return NextResponse.json(await loadQualityOptions());
  } catch (error) {
    return hubErrorResponse(error, "Could not load filter options.");
  }
}
