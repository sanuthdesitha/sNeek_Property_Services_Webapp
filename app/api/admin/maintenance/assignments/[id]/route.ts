import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { describePay, resolveAssignmentPay } from "@/lib/maintenance/instructions";

export const runtime = "nodejs";

/**
 * THE OFFICE SIDE OF WHAT AN ASSIGNMENT PAYS.
 *
 * The pay columns have existed on the assignment row for a while and the portal
 * has always rendered them — but nothing could ever write them, so they were
 * permanently null and every assignment read "no pay set". Worse, the assignee
 * could already press "this price is wrong", which wrote a PENDING request that
 * no screen in the system could approve or reject. Asking someone to raise a
 * request into a void is worse than not offering the button: they chase it,
 * nobody can find it, and they conclude the number is final.
 *
 * This route is the missing half. Set the pay, and answer the request.
 *
 * SEPARATE FROM `/api/maintenance/assignments/[id]`, which is the assignee
 * acting on their OWN row and is scoped to their own user id. This one is
 * admin-only and can touch anybody's — two different authorities, so two
 * different routes rather than one route with a branch that could be got wrong.
 */

const schema = z
  .object({
    action: z.enum(["SET_PAY", "APPROVE_PAY_CHANGE", "REJECT_PAY_CHANGE"]),
    payType: z.enum(["FIXED", "HOURLY"]).optional(),
    /** FIXED: the whole fee. HOURLY: the rate. */
    payAmount: z.number().min(0).max(1_000_000).optional(),
    payHours: z.number().min(0).max(1000).optional(),
    payPayer: z.enum(["COMPANY", "CLIENT"]).optional(),
    /** Rejections carry a reason; approvals may. */
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.action !== "SET_PAY" || v.payType !== undefined, {
    message: "Choose fixed or hourly.",
  });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));

    const assignment = await db.maintenanceItemAssignment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        userId: true,
        removedAt: true,
        payType: true,
        payAmount: true,
        payHours: true,
        payPayer: true,
        payChangeAmount: true,
        payChangeStatus: true,
        user: { select: { id: true, name: true, email: true } },
        item: { select: { id: true, title: true, property: { select: { name: true } } } },
      },
    });
    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    }
    if (assignment.removedAt) {
      return NextResponse.json({ error: "That person is no longer on this item." }, { status: 409 });
    }

    const before = resolveAssignmentPay(assignment);

    if (body.action === "SET_PAY") {
      // Validate through the same resolver the portal and the invoice read, so
      // an admin cannot save a combination that renders as "no pay set" on the
      // assignee's phone — an hourly rate with no hours being the obvious one.
      const proposed = resolveAssignmentPay({
        payType: body.payType,
        payAmount: body.payAmount,
        payHours: body.payHours,
        payPayer: body.payPayer,
      });
      if (!proposed) {
        return NextResponse.json(
          {
            error:
              body.payType === "HOURLY"
                ? "An hourly rate needs both a rate and the expected hours."
                : "Enter an amount above zero.",
          },
          { status: 400 }
        );
      }

      await db.maintenanceItemAssignment.update({
        where: { id: assignment.id },
        data: {
          payType: proposed.type,
          payAmount: proposed.amount,
          payHours: proposed.type === "HOURLY" ? proposed.hours : null,
          payPayer: proposed.payer,
        },
      });

      // Only tell them when the figure actually moved. Re-saving an unchanged
      // rate while correcting something else should not send "your pay changed".
      if (!before || before.total !== proposed.total || before.payer !== proposed.payer) {
        await notifyPayee({
          assignment,
          subject: before ? "Your pay for this job has changed" : "Pay set for your job",
          line: before
            ? `The pay for <strong>${escapeHtml(assignment.item.title)}</strong> is now ${describePay(proposed)} (was ${describePay(before)}).`
            : `<strong>${escapeHtml(assignment.item.title)}</strong> pays ${describePay(proposed)}.`,
          note: body.note ?? null,
        });
      }

      return NextResponse.json({ ok: true, id: assignment.id, pay: proposed });
    }

    // ── Answering a price-change request ───────────────────────────────────
    if (assignment.payChangeStatus !== "PENDING") {
      return NextResponse.json(
        { error: "There is no open price request on this assignment." },
        { status: 409 }
      );
    }

    const approving = body.action === "APPROVE_PAY_CHANGE";
    const requested = Number(assignment.payChangeAmount);
    if (approving && (!Number.isFinite(requested) || requested <= 0)) {
      return NextResponse.json({ error: "That request has no usable amount." }, { status: 409 });
    }

    await db.maintenanceItemAssignment.update({
      where: { id: assignment.id },
      data: {
        payChangeStatus: approving ? "APPROVED" : "REJECTED",
        // Approving REPLACES the agreed figure; the request columns stay so a
        // pattern of low quotes remains visible after the fact.
        ...(approving ? { payAmount: requested } : {}),
      },
    });

    const after = approving ? resolveAssignmentPay({ ...assignment, payAmount: requested }) : before;

    await notifyPayee({
      assignment,
      subject: approving ? "Your price request was approved" : "Your price request was declined",
      line: approving
        ? `Your price for <strong>${escapeHtml(assignment.item.title)}</strong> was approved${after ? ` — it now pays ${describePay(after)}` : ""}.`
        : `Your price request for <strong>${escapeHtml(assignment.item.title)}</strong> was not approved${before ? `, so it still pays ${describePay(before)}` : ""}.`,
      note: body.note ?? null,
    });

    return NextResponse.json({ ok: true, id: assignment.id, approved: approving });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    if (status === 400) logger.error({ err, id: params.id }, "[maintenance-pay] admin write failed");
    return NextResponse.json(
      { error: err?.issues?.[0]?.message ?? "Could not save that." },
      { status }
    );
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tell the person whose money it is.
 *
 * Best-effort, and deliberately AFTER the write: an email failure must never
 * roll back a pay decision the office has already made, because the invoice is
 * built from the row and not from the inbox.
 *
 * This always sends, unlike auto-proposed bonuses — every message here answers
 * something the assignee is directly party to, either a price they asked about
 * or a figure they are about to be paid.
 */
async function notifyPayee(input: {
  assignment: {
    user: { name: string | null; email: string | null };
    item: { title: string; property: { name: string | null } | null };
  };
  subject: string;
  line: string;
  note: string | null;
}): Promise<void> {
  try {
    const email = input.assignment.user.email;
    if (!email) return;
    const { sendEmailDetailed } = await import("@/lib/notifications/email");
    const { getAppSettings } = await import("@/lib/settings");
    const settings = await getAppSettings();
    const place = input.assignment.item.property?.name;

    await sendEmailDetailed({
      kind: "job_assignment",
      to: email,
      subject: input.subject,
      html: [
        `<p>Hi ${escapeHtml(input.assignment.user.name ?? "there")},</p>`,
        `<p>${input.line}${place ? ` (${escapeHtml(place)})` : ""}</p>`,
        input.note ? `<p><strong>Note:</strong> ${escapeHtml(input.note)}</p>` : "",
        `<p>— ${escapeHtml(settings.companyName)}</p>`,
      ].join(""),
    });
  } catch (err) {
    logger.error({ err }, "[maintenance-pay] payee email failed; the pay change stands");
  }
}
