import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hireApplicant, loadHirePreview } from "@/lib/hiring/hire";
import { hiringErrorResponse, NO_STORE, requireHiringWriter } from "@/lib/hiring/route-helpers";

/**
 * GET — exactly what "Mark hired and invite" will create, checked before
 * anyone confirms (account role, the email check, documents, learning, and
 * why it cannot happen). `?kind=` previews another account role.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const kind = new URL(req.url).searchParams.get("kind");
    return NextResponse.json(await loadHirePreview(params.id, creator, kind), { headers: NO_STORE });
  } catch (error) {
    return hiringErrorResponse(error, "Could not check the hire.");
  }
}

const bodySchema = z.object({
  accountKind: z.string().trim().max(40).optional(),
  sendSms: z.boolean().default(false),
  idempotencyKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/).optional(),
  opsPacks: z.array(z.string().trim().max(60)).max(60).optional(),
});

/**
 * POST — Mark hired and invite. Creates the account through the shared
 * invitation flow (lib/accounts/create-account.ts) with the explicit account
 * role; operations managers only into Cleaner and Laundry accounts; refused
 * while testing as someone. SMS only when `sendSms` is true. Repeat-safe.
 * The response never holds the invitation link or a password.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { creator } = await requireHiringWriter();
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "The hire request was not understood." }, { status: 400, headers: NO_STORE });
    const result = await hireApplicant({
      applicationId: params.id,
      creator,
      accountKind: parsed.data.accountKind ?? null,
      sendSms: parsed.data.sendSms,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      opsPacks: creator.heldRoles.includes("ADMIN") ? parsed.data.opsPacks : undefined,
    });
    return NextResponse.json(result, { status: result.outcome.replayed ? 200 : 201, headers: NO_STORE });
  } catch (error) {
    return hiringErrorResponse(error, "Could not hire. Nothing was created.");
  }
}
