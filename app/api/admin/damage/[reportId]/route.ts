import { NextResponse } from "next/server";
import { DamageVoidMode, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getDamageInvestigationForAdmin } from "@/lib/damage/investigation";
import { setDamageItemCost, reviewDamageReport } from "@/lib/damage/review";
import { voidDamageReport } from "@/lib/damage/void";
import { getValidationErrorMessage } from "@/lib/validations/errors";

/**
 * D2 — the admin investigation page.
 *
 *   GET   — the full report: items, flattened annotated photos, live case and
 *           maintenance status from CP-7, and the transition timeline.
 *   PATCH — either set an item's cost, or record a review and release/retract
 *           the report to the client.
 *
 * ADMIN and OPS_MANAGER only. Cost and release are the two powers this page
 * has that no other role may reach: the cleaner schemas refuse `estimatedCost`
 * outright, and `clientVisible` is what decides whether a client ever sees the
 * damage at all.
 */

const patchSchema = z.union([
  z.object({
    action: z.literal("SET_COST"),
    itemId: z.string().trim().min(1),
    // Nullable so an admin can clear a figure they entered by mistake.
    estimatedCost: z.number().finite().min(0).nullable(),
  }),
  z.object({
    action: z.literal("REVIEW"),
    /** true releases the report AND its cases to the client; false retracts. */
    release: z.boolean(),
    /** Close the report outright rather than leaving it under review. */
    close: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("VOID"),
    mode: z.nativeEnum(DamageVoidMode),
    /**
     * Required and non-trivial. The cleaner is shown this verbatim, and a void
     * with no usable reason just produces the same report again.
     */
    reason: z
      .string()
      .trim()
      .min(10, "Say why this is being sent back — at least a sentence.")
      .max(2_000),
  }),
]);

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  switch (message) {
    case "UNAUTHORIZED":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    case "FORBIDDEN":
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    case "DAMAGE_REPORT_NOT_FOUND":
    case "DAMAGE_ITEM_NOT_FOUND":
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    case "DAMAGE_REPORT_NOT_SUBMITTED":
      return NextResponse.json(
        { error: "This report is still a draft — the cleaner has not submitted it yet." },
        { status: 409 }
      );
    case "DAMAGE_COST_INVALID":
      return NextResponse.json({ error: "Enter a cost of zero or more." }, { status: 400 });
    default:
      return NextResponse.json(
        { error: getValidationErrorMessage(err, "Could not update the damage report.") },
        { status: 400 }
      );
  }
}

export async function GET(_req: Request, { params }: { params: { reportId: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const report = await getDamageInvestigationForAdmin(params.reportId);
    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: { reportId: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid" }, { status: 400 });
    }
    const body = patchSchema.parse(payload);

    if (body.action === "SET_COST") {
      await setDamageItemCost({ itemId: body.itemId, estimatedCost: body.estimatedCost });
    } else if (body.action === "VOID") {
      await voidDamageReport({
        reportId: params.reportId,
        actorUserId: session.user.id,
        mode: body.mode,
        reason: body.reason,
      });
    } else {
      await reviewDamageReport({
        reportId: params.reportId,
        reviewerUserId: session.user.id,
        release: body.release,
        close: body.close,
      });
    }

    // Re-read so the browser renders exactly what was stored rather than
    // optimistically guessing — cost and release both change derived state.
    const report = await getDamageInvestigationForAdmin(params.reportId);
    return NextResponse.json({ report });
  } catch (err) {
    return errorResponse(err);
  }
}
