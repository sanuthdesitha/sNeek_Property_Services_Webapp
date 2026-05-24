import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { z } from "zod";

const schema = z.object({
  jobId: z.string().min(1),
  expiresInHours: z.number().int().min(1).max(168).default(72),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * V2 client self-QA invites.
 *
 * Lets ADMIN / OPS_MANAGER issue a tokenized review link to a job's client.
 * Reuses the existing `JobFeedback` model — one feedback per job (jobId is unique),
 * so calling this endpoint repeatedly on the same job refreshes the token and
 * extends the expiry window. The link lands on /feedback/[token], handled by
 * the existing public feedback page + /api/public/feedback POST.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "OPS_MANAGER")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const job = await db.job.findUnique({
    where: { id: parsed.data.jobId },
    include: { property: { include: { client: true } } },
  });
  if (!job || !job.property?.client) {
    return NextResponse.json({ error: "Job or client not found" }, { status: 404 });
  }
  const client = job.property.client;
  const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 60 * 60 * 1000);

  // Upsert keyed on the job. Prisma generates a fresh cuid token on create;
  // on update we rotate the token so previously-sent links can no longer be used.
  const existing = await db.jobFeedback.findUnique({ where: { jobId: job.id } });

  let feedback;
  if (!existing) {
    feedback = await db.jobFeedback.create({
      data: {
        jobId: job.id,
        clientId: client.id,
        tokenExpiresAt: expiresAt,
      },
    });
  } else {
    // Rotate the token by setting it to a new cuid value via the cuid default.
    // Prisma doesn't expose the default on update, so generate one manually.
    const { randomBytes } = await import("crypto");
    const newToken = "tk_" + randomBytes(18).toString("base64url");
    feedback = await db.jobFeedback.update({
      where: { jobId: job.id },
      data: {
        token: newToken,
        tokenExpiresAt: expiresAt,
        // Clear any prior submission so the client can re-rate after refresh.
        submittedAt: null,
        rating: null,
        comment: null,
      },
    });
  }

  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  const link = `${baseUrl.replace(/\/$/, "")}/feedback/${feedback.token}`;

  let emailed = false;
  let emailError: string | null = null;
  if (client.email) {
    const result = await sendEmailDetailed({
      to: client.email,
      subject: "Please review your recent clean",
      html: `<p>Hi ${client.name ?? "there"},</p><p>We'd love your feedback on your recent clean at <strong>${job.property?.name ?? "your property"}</strong>. Please take a moment to rate the job:</p><p><a href="${link}">${link}</a></p><p>This link expires in ${parsed.data.expiresInHours} hours.</p><p>— sNeek</p>`,
      transactional: true,
    });
    emailed = !!result.ok;
    if (!result.ok) emailError = result.error ?? "Email failed";
  }

  return NextResponse.json({
    ok: true,
    token: feedback.token,
    expiresAt: feedback.tokenExpiresAt,
    link,
    emailed,
    emailError,
  });
}
