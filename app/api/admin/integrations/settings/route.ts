import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  getPhase3IntegrationsSettings,
  savePhase3IntegrationsSettings,
} from "@/lib/phase3/integrations";
import { isValidXeroAccountCode } from "@/lib/xero/cleaner-bill-accounts";

const accountCode = z
  .string()
  .trim()
  .max(10, "A Xero account code is at most 10 characters.")
  .refine(isValidXeroAccountCode, "A Xero account code uses letters, digits, dot, dash or underscore, as in your Xero chart of accounts.")
  .optional();

const schema = z.object({
  stripe: z
    .object({
      enabled: z.boolean().optional(),
      currency: z.string().trim().min(1).max(8).optional(),
      successUrl: z.string().trim().optional(),
      cancelUrl: z.string().trim().optional(),
      statementDescriptor: z.string().trim().max(22).optional(),
    })
    .optional(),
  xero: z
    .object({
      enabled: z.boolean().optional(),
      tenantId: z.string().trim().max(200).optional(),
      // Client invoice accounts (2026-11-23): empty clears (the push is then
      // refused); anything else must be a Xero account code.
      defaultAccountCode: accountCode,
      defaultAccountCodeConfirmed: z.literal(true).optional(),
      clientRepairsAccountCode: accountCode,
      clientShoppingAccountCode: accountCode,
      clientCreditNoteAccountCode: accountCode,
      disbursementAccountCode: accountCode,
      defaultItemCode: z.string().trim().max(30).optional(),
      itemCodeByService: z.record(z.string().trim().max(30)).optional(),
      salesTaxType: z.string().trim().max(50).optional(),
      trackingCategory: z.string().trim().max(100).optional(),
      contactFallbackEmail: z.string().trim().max(200).optional(),
      // Cleaner bill accounts (2026-11-23): empty clears; anything else must be a Xero account code.
      cleanerBillAccountCode: accountCode,
      cleanerBillInspectionAccountCode: accountCode,
      cleanerBillReimbursementAccountCode: accountCode,
    })
    .optional(),
  googlePlaces: z
    .object({
      placeId: z.string().trim().max(300).optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getPhase3IntegrationsSettings();
    return NextResponse.json(settings);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Only administrators change these: both screens that write them
    // (Settings › Xero, v2 and classic) are administrator-only, and they now
    // decide which Xero accounts money is booked to (2026-11-23).
    const session = await requireRole([Role.ADMIN]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const before = await getPhase3IntegrationsSettings();
    const next = await savePhase3IntegrationsSettings(body);
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PHASE3_INTEGRATIONS_UPDATE",
        entity: "Phase3Integrations",
        entityId: "phase3_integrations_v1",
        before: before as any,
        after: next as any,
      },
    });
    return NextResponse.json(next);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    // A refused field says which rule it broke (e.g. a Xero account code), not zod's JSON.
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? "Update failed." : err.message ?? "Update failed.";
    return NextResponse.json({ error: message }, { status });
  }
}
