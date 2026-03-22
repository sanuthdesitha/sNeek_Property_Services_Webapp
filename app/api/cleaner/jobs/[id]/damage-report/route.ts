import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createCase } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";

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

    const issue = await createCase({
      title: `Damage: ${body.title}`,
      description: fullDescription,
      severity: body.severity ?? "HIGH",
      status: "OPEN",
      caseType: "DAMAGE",
      source: "CLEANER_SUBMISSION",
      clientId: job.property.clientId,
      propertyId: job.propertyId,
      jobId: job.id,
      clientVisible: true,
      clientCanReply: true,
      metadata: {
        tags: ["damage"],
        estimatedCost: body.estimatedCost ?? null,
        currency: body.currency ?? "AUD",
      },
      comment: {
        authorUserId: session.user.id,
        body: fullDescription,
        isInternal: false,
      },
      attachments: evidenceKeys.map((key) => ({
        uploadedByUserId: session.user.id,
        s3Key: key,
      })),
    });

    if (issue) {
      await notifyCaseCreated({
        caseItem: issue,
        actorLabel: session.user.name || session.user.email || "Cleaner",
      });
    }

    return NextResponse.json({ issue }, { status: 201 });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create damage report." }, { status });
  }
}
