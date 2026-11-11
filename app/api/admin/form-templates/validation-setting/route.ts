import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z, ZodError } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { EXTENDED_FORM_RULES } from "@/lib/forms/validate-submission";
import { nextFormValidationSettings, sanitizeFormValidationSettings } from "@/lib/forms/validation-enforcement";
import { loadValidationWarningStats } from "@/lib/forms/validation-warning-stats";

/**
 * GET  /api/admin/form-templates/validation-setting — the "Reject submissions
 *      that break these checks" switch, the checks it covers, and the real
 *      warning counts (null when they could not be read). ADMIN and
 *      OPS_MANAGER can read.
 * PUT  { enforce: boolean } — ADMIN only; audited (FORM_VALIDATION_ENFORCEMENT).
 *      Switching on stamps the moment: jobs the cleaner started before it are
 *      still accepted with warnings (lib/forms/validation-enforcement.ts).
 */
export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    let stats = null;
    let statsError: string | null = null;
    try {
      stats = await loadValidationWarningStats();
    } catch {
      statsError = "The warning counts could not be read.";
    }
    return NextResponse.json(
      { setting: sanitizeFormValidationSettings(settings.formValidation), rules: Array.from(EXTENDED_FORM_RULES), stats, statsError },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}

const putZ = z.object({ enforce: z.boolean() }).strict();

export async function PUT(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const { enforce } = putZ.parse(await req.json());
    const current = sanitizeFormValidationSettings((await getAppSettings()).formValidation);
    const next = nextFormValidationSettings(current, enforce, new Date());
    if (next !== current) {
      await saveAppSettings({ formValidation: next });
      await db.auditLog.create({
        data: { userId: session.user.id, action: "FORM_VALIDATION_ENFORCEMENT", entity: "AppSetting", entityId: "app.formValidation", before: current, after: next },
      });
    }
    return NextResponse.json({ setting: next });
  } catch (err: unknown) {
    if (err instanceof ZodError) return NextResponse.json({ error: "Send { enforce: true | false }." }, { status: 400 });
    const message = err instanceof Error ? err.message : "Request failed";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400 });
  }
}
