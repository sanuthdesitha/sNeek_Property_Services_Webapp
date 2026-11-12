import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { ACCOUNT_EMAIL_TYPES } from "@/lib/accounts/account-email-rules";
import { AccountEmailError, accountEmailOverview, resolveAccountEmailActor, sendAccountEmail } from "@/lib/accounts/account-emails";

const headers = { "Cache-Control": "private, no-store" };
const sendSchema = z.object({ type: z.enum(ACCOUNT_EMAIL_TYPES) }).strict();

function failure(error: unknown) {
  if (error instanceof AccountEmailError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Choose which email to send." }, { status: 400, headers });
  const message = error instanceof Error ? error.message : "";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
  return NextResponse.json({ error: status === 500 ? "Could not complete the request." : message }, { status, headers });
}

/**
 * GET /api/admin/users/[id]/account-emails — the person's account emails:
 * what was sent, when, to which address and the provider's recorded answer,
 * and which emails this viewer may send now (with the reason when not).
 * ADMIN and OPS_MANAGER can read; sending needs the rules in POST.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await resolveAccountEmailActor(session).catch((error: unknown) => {
      if (error instanceof AccountEmailError) return { refused: error.message };
      throw error;
    });
    return NextResponse.json(await accountEmailOverview(actor, params.id), { headers });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST /api/admin/users/[id]/account-emails { type } — send a fresh
 * invitation, password reset link or sign-up code to the person's own account
 * address. ADMIN, or OPS_MANAGER with Staff accounts at manage; never while
 * impersonating; never to a person whose role is above the sender's.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const actor = await resolveAccountEmailActor(session);
    const body = sendSchema.parse(await req.json().catch(() => null));
    return NextResponse.json(await sendAccountEmail(actor, params.id, body.type, "PERSON_PANEL"), { headers });
  } catch (error) {
    return failure(error);
  }
}
