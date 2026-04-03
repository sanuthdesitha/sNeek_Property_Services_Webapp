import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";

function buildTemplate(template: string, application: any) {
  const safeName = application.fullName || "there";
  const positionTitle = application.position?.title || "the role";
  const interviewDate = application.interviewDate ? new Date(application.interviewDate).toLocaleString("en-AU") : "to be confirmed";
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
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = await req.json().catch(() => ({}));
    const template = String(body.template ?? "thank_you");
    const application = await db.hiringApplication.findUnique({
      where: { id: params.id },
      include: { position: { select: { title: true } } },
    });
    if (!application) {
      return NextResponse.json({ error: "Application not found." }, { status: 404 });
    }
    const email = buildTemplate(template, application);
    const result = await sendEmailDetailed({ to: application.email, subject: email.subject, html: email.html });
    return NextResponse.json({ ok: result.ok });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not send hiring email." }, { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 });
  }
}
