import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { findAccountByEmail } from "@/lib/accounts/create-account";
import { emailInUseMessage } from "@/lib/accounts/create-account-rules";

const headers = { "Cache-Control": "private, no-store" };

/**
 * GET /api/admin/users/email-check?email=&purpose=staff|client-login — the
 * Invite person hint ("No other account uses this email") and the
 * email-in-use state, before anything is created. Administrators only, as
 * Invite person is. The create request checks again in its transaction.
 */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN]);
    const params = new URL(req.url).searchParams;
    const email = (params.get("email") ?? "").trim().toLowerCase().slice(0, 200);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ checked: false }, { headers });
    const existing = await findAccountByEmail(email);
    const purpose = params.get("purpose") === "client-login" ? "client-login" : "staff";
    return NextResponse.json({ checked: true, inUse: Boolean(existing), message: existing ? emailInUseMessage(existing, purpose) : null, existing }, { headers });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 500;
    return NextResponse.json({ error: status === 500 ? "Could not check the email." : err.message }, { status, headers });
  }
}
