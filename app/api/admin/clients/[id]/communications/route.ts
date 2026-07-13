import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Per-client Communications hub — history feed.
 *
 * Returns the recent client-facing notifications (emails logged by the lifecycle
 * service, keyed to the client's login users OR the client's jobs) plus the
 * client's recent jobs so the hub's job picker can populate.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

    const client = await db.client.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    // The client's jobs (via property.clientId) — used both for the picker and
    // to catch notifications that carry a jobId but no user (delivery-profile
    // recipients log with userId null).
    const jobs = await db.job.findMany({
      where: { property: { clientId: params.id } },
      orderBy: { scheduledDate: "desc" },
      take: 25,
      select: {
        id: true,
        jobNumber: true,
        jobType: true,
        scheduledDate: true,
        status: true,
        property: { select: { name: true, suburb: true } },
      },
    });
    const jobIds = jobs.map((j) => j.id);

    const notifications = await db.notification.findMany({
      where: {
        OR: [
          { user: { clientId: params.id } },
          ...(jobIds.length > 0 ? [{ jobId: { in: jobIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        channel: true,
        subject: true,
        body: true,
        status: true,
        sentAt: true,
        createdAt: true,
        jobId: true,
      },
    });

    return NextResponse.json({
      notifications,
      jobs: jobs.map((j) => ({
        id: j.id,
        jobNumber: j.jobNumber,
        jobType: j.jobType,
        scheduledDate: j.scheduledDate,
        status: j.status,
        propertyName: j.property
          ? j.property.suburb
            ? `${j.property.name} (${j.property.suburb})`
            : j.property.name
          : null,
      })),
    });
  } catch (err: any) {
    const status =
      err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err?.message ?? "Could not load communications." }, { status });
  }
}
