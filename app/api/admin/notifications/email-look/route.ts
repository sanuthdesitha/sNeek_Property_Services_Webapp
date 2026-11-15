import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { lookEditRefusal } from "@/lib/email-design/permission";
import { discardThemeDraft, EmailDesignError, saveThemeDraft } from "@/lib/email-design/store";
import { DESIGN_HEADERS, designError, lookView } from "@/lib/email-design/view";

/**
 * GET: the Email look (published, draft, contrast checks, Company details).
 * PUT { action: "DRAFT" | "DISCARD", theme?, expectedRevision }: change the
 * draft only. ADMIN only, never while impersonating; a colour whose button
 * text would be under 4.5:1 is refused (400). Publishing has its own route.
 */
const bodySchema = z.object({ action: z.enum(["DRAFT", "DISCARD"]), expectedRevision: z.number().int().min(0), theme: z.unknown().optional() });

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    return NextResponse.json(await lookView(session), { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = lookEditRefusal(session);
    if (refusal) throw new EmailDesignError(403, refusal);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new EmailDesignError(400, "Invalid request. Nothing was saved.");
    const actor = { id: session.user.id, name: session.user.name ?? null, role: "ADMIN" };
    const row = parsed.data.action === "DRAFT"
      ? await saveThemeDraft({ theme: parsed.data.theme, expectedRevision: parsed.data.expectedRevision, actor })
      : await discardThemeDraft({ expectedRevision: parsed.data.expectedRevision, actor });
    return NextResponse.json(await lookView(session, row), { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
