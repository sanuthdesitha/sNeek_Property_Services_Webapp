import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { acknowledgeDamageReport } from "@/lib/damage/acknowledge";
import { getValidationErrorMessage } from "@/lib/validations/errors";

/**
 * D4 — the client signs off on a damage report.
 *
 * The second half of verification: the /verify code proves the document is
 * genuine to anyone holding it, this records that the client read and accepted
 * it. Both are required for a report to count as verified.
 *
 * POST only, and idempotent — a repeat call returns the existing sign-off
 * rather than restamping it or erroring, so a double-tap on a phone is not a
 * failure. The eligibility gate lives in lib/damage/acknowledge.ts and is the
 * same query the read path uses, so a client can never sign something they were
 * never shown.
 */

const bodySchema = z.object({
  /** Typed name, kept verbatim — the signatory may not be the account holder. */
  signedName: z.string().trim().min(2, "Enter the name of the person signing off.").max(120),
});

export async function POST(req: Request, { params }: { params: { reportId: string } }) {
  try {
    const session = await requireRole([Role.CLIENT]);

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }
    const body = bodySchema.parse(payload);

    const result = await acknowledgeDamageReport({
      reportId: params.reportId,
      clientId: user.clientId,
      userId: session.user.id,
      signedName: body.signedName,
    });

    return NextResponse.json({ acknowledgement: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (message === "DAMAGE_REPORT_NOT_FOUND") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (message === "DAMAGE_ACK_NAME_REQUIRED") {
      return NextResponse.json(
        { error: "Enter the name of the person signing off." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: getValidationErrorMessage(err, "Could not record the acknowledgement.") },
      { status: 400 }
    );
  }
}
