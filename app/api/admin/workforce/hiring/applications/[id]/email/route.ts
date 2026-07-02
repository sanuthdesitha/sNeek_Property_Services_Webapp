import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { recordHiringEmailSent } from "@/lib/workforce/service";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildTemplate(template: string, application: any) {
  // Candidate-controlled (fullName comes from the public apply form) — escape so
  // it can't inject markup into the preview or the outbound email.
  const safeName = escapeHtml(application.fullName || "there");
  const positionTitle = escapeHtml(application.position?.title || "the role");
  const interviewDate = escapeHtml(
    application.interviewDate
      ? new Date(application.interviewDate).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })
      : "to be confirmed"
  );
  if (template === "interview") {
    return {
      subject: `Interview invitation - ${positionTitle}`,
      html: `<p>Hi ${safeName},</p><p>We would like to invite you to interview for ${positionTitle}.</p><p>Interview time: <strong>${interviewDate}</strong></p><p>Please reply if you need to adjust the time.</p>`,
    };
  }
  if (template === "offer") {
    return {
      subject: `Offer details - ${positionTitle}`,
      html: `<p>Hi ${safeName},</p><p>We are pleased to move forward with an offer for ${positionTitle}.</p><p>Please review the offer details shared with you and reply with any questions.</p>`,
    };
  }
  if (template === "welcome") {
    return {
      subject: `Welcome to sNeek Property Services`,
      html: `<p>Hi ${safeName},</p><p>Welcome to the team. We will send your onboarding and account setup details next.</p>`,
    };
  }
  return {
    subject: `Thank you for applying - ${positionTitle}`,
    html: `<p>Hi ${safeName},</p><p>Thank you for applying for ${positionTitle}. We have received your application and will review it shortly.</p>`,
  };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const template = String(body.template ?? "thank_you");
    const application = await db.hiringApplication.findUnique({
      where: { id: params.id },
      include: { position: { select: { title: true } } },
    });
    if (!application) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }

    // Start from the template, but allow the preview dialog to override subject/
    // body with admin-edited content.
    const built = buildTemplate(template, application);
    const subject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim() : built.subject;
    const html = typeof body.html === "string" && body.html.trim() ? body.html : built.html;

    // Preview mode: return the rendered email without sending (used by the
    // send/don't-send confirmation dialog).
    if (body.preview === true) {
      return NextResponse.json({ subject, html, to: application.email, template });
    }

    const result = await sendEmailDetailed({ to: application.email, subject, html, transactional: true });
    if (result.ok) {
      await recordHiringEmailSent({
        applicationId: application.id,
        actorId: session.user.id,
        subject,
        to: application.email,
        template,
        body: html,
      });
    }
    return NextResponse.json({ ok: result.ok, error: result.ok ? undefined : result.error });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not send hiring email." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
