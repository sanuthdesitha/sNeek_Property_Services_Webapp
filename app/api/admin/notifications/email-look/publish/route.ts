import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { lookEditRefusal, publishRefusal } from "@/lib/email-design/permission";
import { EmailDesignError, publishTheme } from "@/lib/email-design/store";
import { DESIGN_HEADERS, designError, lookView } from "@/lib/email-design/view";

/**
 * POST { expectedRevision, idempotencyKey, security }: publish the draft
 * Email look; every email uses it from the next send. ADMIN only, never while
 * impersonating, with the person's own PIN in this request; audited
 * EMAIL_LOOK_PUBLISHED.
 */
const bodySchema = z.object({ expectedRevision: z.number().int().min(0), idempotencyKey: z.string().min(8).max(100).optional().nullable(), security: z.unknown().optional() });

export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = lookEditRefusal(session) ?? publishRefusal(session);
    if (refusal) throw new EmailDesignError(403, refusal);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new EmailDesignError(400, "Invalid request. Nothing was published.");
    const security = await routeSecurityRefusal(session, securityFromBody(parsed.data) ?? null);
    if (security) return security;
    const { row, version } = await publishTheme({ expectedRevision: parsed.data.expectedRevision, idempotencyKey: parsed.data.idempotencyKey ?? null, actor: { id: session.user.id, name: session.user.name ?? null, role: "ADMIN" } });
    return NextResponse.json({ version, view: await lookView(session, row) }, { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
