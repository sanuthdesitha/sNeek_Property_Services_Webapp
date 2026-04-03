import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createCase, listCases, toClientCaseView } from "@/lib/cases/service";
import { notifyCaseCreated } from "@/lib/cases/notifications";

const querySchema = z.object({
  status: z.string().trim().optional(),
});

const createSchema = z.object({
  propertyId: z.string().trim().optional().nullable(),
  jobId: z.string().trim().optional().nullable(),
  reportId: z.string().trim().optional().nullable(),
  title: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(6000),
  caseType: z.enum(["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OTHER"]).optional(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  attachments: z.array(
    z.object({
      s3Key: z.string().trim().min(1),
      url: z.string().trim().optional().nullable(),
      mimeType: z.string().trim().optional().nullable(),
      label: z.string().trim().optional().nullable(),
    })
  ).max(3).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const { searchParams } = new URL(req.url);
    const query = querySchema.parse({
      status: searchParams.get("status") ?? undefined,
    });
    const items = await listCases({
      clientId: user.clientId,
      status: query.status ?? null,
      clientVisibleOnly: true,
    });
    return NextResponse.json(items.map((item) => toClientCaseView(item)));
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load cases." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const caseType = body.caseType ?? "CLIENT_DISPUTE";
    const title =
      body.title?.trim() ||
      (caseType === "DAMAGE"
        ? "Damage reported"
        : caseType === "LOST_FOUND"
          ? "Lost or found item"
          : caseType === "OTHER"
            ? "Service issue"
            : "Client dispute");
    const created = await createCase({
      title,
      description: body.description,
      severity: body.severity ?? "MEDIUM",
      status: "OPEN",
      caseType,
      source: "CLIENT_PORTAL",
      clientId: user.clientId,
      propertyId: body.propertyId ?? null,
      jobId: body.jobId ?? null,
      reportId: body.reportId ?? null,
      clientVisible: true,
      clientCanReply: true,
      comment: {
        authorUserId: session.user.id,
        body: body.description,
        isInternal: false,
      },
      attachments: (body.attachments ?? []).map((attachment) => ({
        uploadedByUserId: session.user.id,
        s3Key: attachment.s3Key,
        url: attachment.url ?? null,
        mimeType: attachment.mimeType ?? null,
        label: attachment.label ?? null,
      })),
    });
    if (created) {
      await notifyCaseCreated({
        caseItem: created,
        actorLabel: session.user.name || session.user.email || "Client",
      });
    }

    return NextResponse.json(created ? toClientCaseView(created) : created, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not create case." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
