import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const templateId = searchParams.get("templateId") || undefined;

    const submissions = await db.formSubmission.findMany({
      where: { ...(templateId ? { templateId } : {}) },
      include: {
        template: { select: { id: true, name: true, serviceType: true } },
        submittedBy: { select: { id: true, name: true, email: true } },
        media: { select: { id: true, fieldId: true, url: true, mediaType: true, createdAt: true } },
        job: {
          select: {
            id: true,
            status: true,
            scheduledDate: true,
            jobType: true,
            report: { select: { id: true, pdfUrl: true, updatedAt: true } },
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json(submissions);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
