import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  getPhase3IntegrationsSettings,
  savePhase3IntegrationsSettings,
} from "@/lib/phase3/integrations";

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
      defaultAccountCode: z.string().trim().max(32).optional(),
      trackingCategory: z.string().trim().max(100).optional(),
      contactFallbackEmail: z.string().trim().max(200).optional(),
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
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
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
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}
