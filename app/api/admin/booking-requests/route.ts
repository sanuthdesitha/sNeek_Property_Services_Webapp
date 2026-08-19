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
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import type { BookingDecisionNotice } from "@/lib/booking/requests";

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Tell the client what was decided.
 *
 * Best-effort and deliberately after the decision: the job exists (or the
 * request is closed) whether or not this lands, and failing the request
 * because an email bounced would leave the admin re-clicking approve on
 * something already approved. The outcome is reported instead.
 *
 * A booking the client asked for and never heard back about is the whole
 * reason this queue is worth having — silence is what the old flow gave them,
 * only with a job attached.
 */
async function notifyClientOfDecision(input: {
  notice: BookingDecisionNotice;
  outcome: "approved" | "declined";
  scheduledDate?: string;
  reason?: string;
}): Promise<{ notified: boolean; notifyError?: string }> {
  const { notice } = input;
  if (!notice.email) {
    return { notified: false, notifyError: "No email address on file for this client." };
  }

  try {
    const settings = await getAppSettings();
    const service = String(notice.jobType ?? "clean").replace(/_/g, " ");
    const place = notice.propertyName ? " at " + escapeHtml(notice.propertyName) : "";

    const moved =
      input.outcome === "approved" &&
      Boolean(notice.requestedDate) &&
      Boolean(input.scheduledDate) &&
      notice.requestedDate !== input.scheduledDate;

    const subject =
      input.outcome === "approved"
        ? settings.companyName + " — your booking is confirmed"
        : settings.companyName + " — we could not take that booking";

    const movedLine = moved
      ? "<p>You asked for " +
        escapeHtml(notice.requestedDate ?? "") +
        " — we have moved it to the date above to fit the team. Let us know if that does not suit.</p>"
      : "";

    const reasonLine = input.reason
      ? "<p><strong>Why:</strong> " + escapeHtml(input.reason) + "</p>"
      : "";

    const html =
      input.outcome === "approved"
        ? "<p>Hello " +
          escapeHtml(notice.clientName) +
          ",</p><p>Your " +
          escapeHtml(service) +
          place +
          " is confirmed for <strong>" +
          escapeHtml(input.scheduledDate ?? notice.requestedDate ?? "") +
          "</strong>.</p>" +
          movedLine +
          "<p>We will confirm your cleaner closer to the day.</p>"
        : "<p>Hello " +
          escapeHtml(notice.clientName) +
          ",</p><p>We are sorry — we could not take your " +
          escapeHtml(service) +
          place +
          (notice.requestedDate ? " on " + escapeHtml(notice.requestedDate) : "") +
          ".</p>" +
          reasonLine +
          "<p>Please book another date, or reply to this email and we will find one that works.</p>";

    const sent = await sendEmailDetailed({
      to: [notice.email],
      subject,
      html,
      transactional: true,
    });
    return { notified: sent.ok, notifyError: sent.ok ? undefined : sent.error };
  } catch (err: any) {
    logger.error({ err }, "Booking decision notification failed");
    return { notified: false, notifyError: err?.message ?? "Notification failed." };
  }
}

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
      const { notice, ...result } = await approveBookingRequest({
        requestId: body.requestId,
        adminUserId: session.user.id,
        scheduledDate: body.scheduledDate,
      });
      const notified = await notifyClientOfDecision({
        notice,
        outcome: "approved",
        scheduledDate: result.scheduledDate,
      });
      return NextResponse.json({ ok: true, ...result, ...notified });
    }

    const { notice } = await declineBookingRequest({
      requestId: body.requestId,
      adminUserId: session.user.id,
      reason: body.reason,
    });
    const notified = await notifyClientOfDecision({
      notice,
      outcome: "declined",
      reason: body.reason,
    });
    return NextResponse.json({ ok: true, ...notified });
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
