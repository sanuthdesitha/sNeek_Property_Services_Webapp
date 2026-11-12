import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { recordHiringEmailSent } from "@/lib/workforce/service";
import { loadNotificationWording, type WordingRenderer } from "@/lib/notifications/wording/render";

const HIRING_PARTS: Record<string, string> = {
  interview: "hiring-interview",
  offer: "hiring-offer",
  welcome: "hiring-welcome",
};

/**
 * The starting text of a hiring email, from the editable wording (catalog type
 * workforce.updates). Candidate-controlled values (the name comes from the
 * public apply form) are escaped by the renderer.
 */
function buildTemplate(template: string, application: any, wording: WordingRenderer) {
  const email = wording.render(HIRING_PARTS[template] ?? "hiring-thank-you", "EMAIL", {
    candidateName: application.fullName || "there",
    positionTitle: application.position?.title || "the role",
    interviewDate: application.interviewDate
      ? new Date(application.interviewDate).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })
      : "to be confirmed",
  });
  return { subject: email.subject, html: email.html };
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
    const built = buildTemplate(template, application, await loadNotificationWording("workforce.updates"));
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
