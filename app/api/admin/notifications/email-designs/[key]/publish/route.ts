import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { routeSecurityRefusal, securityFromBody } from "@/lib/security/route-verification";
import { publishRefusal } from "@/lib/email-design/permission";
import { EmailDesignError, getPublishedEmailTheme, publishDesign } from "@/lib/email-design/store";
import { DESIGN_HEADERS, designError, designView } from "@/lib/email-design/view";
import { findEmailDesign } from "@/lib/email-design/all-designs";
import { notifyEmailDesignPublished } from "@/lib/email-design/publish-notice";

/**
 * POST { expectedRevision, idempotencyKey, change, security }: publish the
 * draft as a new version. ADMIN only, never while impersonating, confirmed
 * with the person's own PIN in this request (tier C: routeSecurityRefusal →
 * verifySensitiveAction, audited SENSITIVE_ACTION_CONFIRMED), refused while
 * the checks list has errors, audited EMAIL_DESIGN_PUBLISHED. A retry with
 * the same idempotency key returns the version it made.
 */
const bodySchema = z.object({
  expectedRevision: z.number().int().min(0),
  idempotencyKey: z.string().min(8).max(100).optional().nullable(),
  change: z.string().max(200).optional(),
  security: z.unknown().optional(),
});

export async function POST(request: Request, { params }: { params: { key: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = publishRefusal(session);
    if (refusal) throw new EmailDesignError(403, refusal);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new EmailDesignError(400, "Invalid request. Nothing was published.");
    const security = await routeSecurityRefusal(session, securityFromBody(parsed.data) ?? null);
    if (security) return security;
    const theme = await getPublishedEmailTheme();
    const { row, version } = await publishDesign({
      key: params.key,
      expectedRevision: parsed.data.expectedRevision,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      change: parsed.data.change ?? "",
      theme,
      actor: { id: session.user.id, name: session.user.name ?? null, role: "ADMIN" },
    });
    const definition = findEmailDesign(params.key);
    if (definition) await notifyEmailDesignPublished({ key: definition.key, label: definition.label, typeKey: definition.typeKey, version, change: parsed.data.change ?? "", actor: { id: session.user.id, name: session.user.name ?? null } });
    return NextResponse.json({ version, view: await designView(session, params.key, row) }, { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
