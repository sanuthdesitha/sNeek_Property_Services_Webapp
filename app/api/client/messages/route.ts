import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { propertyScopeWhere, requireClientPortal } from "@/lib/auth/client-portal";
import { db } from "@/lib/db";
import { notifyAdminsByEmail, notifyAdminsByPush } from "@/lib/notifications/admin-alerts";

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
  // Optional per-job thread — null/omitted = the client's global thread.
  jobId: z.string().cuid().optional().nullable(),
});

export const dynamic = "force-dynamic";

/** Batch-resolve job chips (jobNumber + property name) for job-thread rows. */
async function buildJobChips(rows: Array<{ jobId: string | null }>) {
  const jobIds = Array.from(
    new Set(rows.map((row) => row.jobId).filter((id): id is string => Boolean(id)))
  );
  if (jobIds.length === 0) return {} as Record<string, { id: string; jobNumber: string | null; propertyName: string | null }>;
  const jobs = await db.job.findMany({
    where: { id: { in: jobIds } },
    select: { id: true, jobNumber: true, property: { select: { name: true } } },
  });
  return Object.fromEntries(
    jobs.map((job) => [
      job.id,
      { id: job.id, jobNumber: job.jobNumber, propertyName: job.property?.name ?? null },
    ])
  );
}

export async function GET(req: NextRequest) {
  try {
    // One chokepoint: role check, client resolution and the "messages" grant.
    // A VA posts under their own user id, so the thread shows who really wrote.
    const portal = await requireClientPortal({ permission: "messages" });

    // ?jobId= scopes to that job's thread; absent = every message (global page
    // shows job-thread rows with a job chip).
    const jobId = req.nextUrl.searchParams.get("jobId")?.trim() || null;

    const rows = await db.clientMessage.findMany({
      where: { clientId: portal.clientId, ...(jobId ? { jobId } : {}) },
      include: {
        sentBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    await db.clientMessage.updateMany({
      where: {
        clientId: portal.clientId,
        ...(jobId ? { jobId } : {}),
        isFromAdmin: true,
        isRead: false,
      },
      data: { isRead: true },
    });

    const jobChips = await buildJobChips(rows);
    return NextResponse.json(
      rows.map((row) => ({ ...row, job: row.jobId ? jobChips[row.jobId] ?? null : null }))
    );
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load messages." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    // One chokepoint: role check, client resolution and the "messages" grant.
    // A VA posts under their own user id, so the thread shows who really wrote.
    const portal = await requireClientPortal({ permission: "messages" });

    const body = schema.parse(await req.json().catch(() => ({})));
    const client = await db.client.findUnique({
      where: { id: portal.clientId },
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    // Per-job thread: the job must belong to this client.
    let job: { id: string; jobNumber: string | null; property: { name: string } | null } | null = null;
    if (body.jobId) {
      job = await db.job.findFirst({
        where: { id: body.jobId, property: propertyScopeWhere(portal) },
        select: { id: true, jobNumber: true, property: { select: { name: true } } },
      });
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
    }

    const message = await db.clientMessage.create({
      data: {
        clientId: client.id,
        jobId: job?.id ?? null,
        sentById: portal.userId,
        body: body.body,
        isFromAdmin: false,
      },
      include: {
        sentBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const jobLabel = job
      ? ` about job${job.jobNumber ? ` #${job.jobNumber}` : ""}${job.property?.name ? ` (${job.property.name})` : ""}`
      : "";
    await Promise.all([
      notifyAdminsByPush({
        subject: "New client message",
        body: `${client.name} sent a new message${jobLabel} in the client portal.`,
      }),
      notifyAdminsByEmail({
        subject: `New client message from ${client.name}`,
        html: `<p><strong>${client.name}</strong> sent a new portal message${jobLabel}.</p><p>${body.body}</p>`,
      }),
    ]);

    return NextResponse.json(
      {
        ...message,
        job: job
          ? { id: job.id, jobNumber: job.jobNumber, propertyName: job.property?.name ?? null }
          : null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send message." }, { status });
  }
}
