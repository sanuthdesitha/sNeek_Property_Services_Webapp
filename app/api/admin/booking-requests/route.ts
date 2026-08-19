import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import {
  BookingRequestError,
  approveBookingRequest,
  declineBookingRequest,
  getTeamAvailability,
  listPendingBookingRequests,
} from "@/lib/booking/requests";
import { logger } from "@/lib/logger";

/**
 * The admin side of client self-serve bookings.
 *
 * GET returns the pending queue AND team availability for each requested date,
 * because the decision is not "does this client want a clean" — it is "can
 * anyone actually work that day". Availability is computed per DISTINCT date
 * rather than per request, so ten bookings for the same Saturday cost one
 * lookup, not ten.
 */

const decisionSchema = z
  .object({
    requestId: z.string().trim().min(1),
    action: z.enum(["approve", "decline"]),
    /** Approve on a different day than the client asked for. */
    scheduledDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-MM-dd date.")
      .optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    // A decline with no reason leaves the client with a dead booking and no
    // idea why, which becomes a phone call either way.
    if (value.action === "decline" && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Give a reason so the client knows why.",
        path: ["reason"],
      });
    }
  });

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const requests = await listPendingBookingRequests();

    const dateKeys = Array.from(
      new Set(requests.map((r) => r.scheduledDate).filter((d): d is string => Boolean(d)))
    );
    const availabilityRows = await Promise.all(dateKeys.map((key) => getTeamAvailability(key)));
    const availability = Object.fromEntries(availabilityRows.map((row) => [row.dateKey, row]));

    return NextResponse.json({ requests, availability });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: "Could not load booking requests." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = decisionSchema.parse(await req.json());

    if (body.action === "approve") {
      const result = await approveBookingRequest({
        requestId: body.requestId,
        adminUserId: session.user.id,
        scheduledDate: body.scheduledDate,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    await declineBookingRequest({
      requestId: body.requestId,
      adminUserId: session.user.id,
      reason: body.reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err instanceof BookingRequestError) {
      // ALREADY_DECIDED is a 409 rather than a 400: nothing about the request
      // was wrong, someone else simply got there first, and the UI should
      // refresh rather than ask the admin to correct anything.
      const status = err.code === "NOT_FOUND" ? 404 : err.code === "ALREADY_DECIDED" ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    if (status === 400) logger.error({ err }, "Booking request decision failed");
    return NextResponse.json(
      { error: err?.issues?.[0]?.message ?? err?.message ?? "Could not decide this booking." },
      { status }
    );
  }
}
