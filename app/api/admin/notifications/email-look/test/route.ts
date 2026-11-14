import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { lookEditRefusal } from "@/lib/email-design/permission";
import { EmailDesignError } from "@/lib/email-design/store";
import { sendEmailDesignTest } from "@/lib/email-design/test-send";
import { sanitizeTheme, themeProblems } from "@/lib/email-design/theme";
import { DESIGN_HEADERS, designError } from "@/lib/email-design/view";

/**
 * POST { theme? }: send a sample email (the quote email) in the draft look to
 * the signed-in administrator's own address, through the real send path.
 * Never while impersonating.
 */
const bodySchema = z.object({ theme: z.unknown().optional().nullable() });

export async function POST(request: Request) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const refusal = lookEditRefusal(session);
    if (refusal) throw new EmailDesignError(403, refusal);
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new EmailDesignError(400, "Invalid request. Nothing was sent.");
    const theme = parsed.data.theme ? sanitizeTheme(parsed.data.theme) : null;
    if (theme && themeProblems(theme).length) throw new EmailDesignError(400, themeProblems(theme).map((problem) => problem.message).join(" "));
    const outcome = await sendEmailDesignTest({ actorId: session.user.id, actorRole: "ADMIN", key: "quoteSentToClient", doc: null, theme, sampleId: null });
    return NextResponse.json(outcome, { headers: DESIGN_HEADERS });
  } catch (error) {
    return designError(error);
  }
}
