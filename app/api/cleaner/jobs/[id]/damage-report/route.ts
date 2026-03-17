import { NextRequest, NextResponse } from "next/server";
import { NotificationChannel, NotificationStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createDispute } from "@/lib/phase4/disputes";
import { composeCaseDescription } from "@/lib/issues/case-utils";

const schema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(6000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  estimatedCost: z.number().min(0).optional().nullable(),
  currency: z.string().trim().max(8).optional(),
  mediaKeys: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const evidenceKeys = Array.isArray(body.mediaKeys)
      ? body.mediaKeys.filter((key) => key.length > 0 && !key.includes("..")).slice(0, 20)
      : [];
    const evidenceBlock =
      evidenceKeys.length > 0
        ? `\n\nEvidence uploads (${evidenceKeys.length}):\n${evidenceKeys.map((key) => `- ${key}`).join("\n")}`
        : "";
    const fullDescription = `${body.description}${evidenceBlock}`.trim();

    const job = await db.job.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        propertyId: true,
        property: {
          select: { name: true, clientId: true, client: { select: { name: true } } },
        },
      },
    });
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    const caseDescription = composeCaseDescription({
      text: fullDescription,
      metadata: { tags: ["damage"] },
    });

    const issue = await db.issueTicket.create({
      data: {
        jobId: job.id,
        title: `Damage: ${body.title}`,
        description: caseDescription,
        severity: body.severity ?? "HIGH",
        status: "OPEN",
      },
    });

    const dispute = await createDispute({
      clientId: job.property.clientId,
      propertyId: job.propertyId,
      jobId: job.id,
      title: `Damage recovery - ${body.title}`,
      description: fullDescription,
      amountDisputed: body.estimatedCost ?? null,
      currency: body.currency ?? "AUD",
      priority: (body.severity as any) ?? "HIGH",
      raisedByUserId: session.user.id,
    });

    const admins = await db.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true },
      select: { id: true },
    });
    if (admins.length > 0) {
      await db.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          jobId: job.id,
          channel: NotificationChannel.PUSH,
          subject: "Damage case opened",
          body: `${job.property.name}: ${body.title}${evidenceKeys.length > 0 ? ` (${evidenceKeys.length} photo(s))` : ""}`,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }

    return NextResponse.json({ issue, dispute }, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create damage report." }, { status });
  }
}
