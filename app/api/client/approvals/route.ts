import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listClientApprovals } from "@/lib/commercial/client-approvals";

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true, email: true },
    });
    if (!user) {
      return NextResponse.json([], { status: 200 });
    }

    const normalizedEmail = user.email?.trim().toLowerCase() || null;
    const emailMatchedClientIds = normalizedEmail
      ? (
          await db.client.findMany({
            where: { email: normalizedEmail },
            select: { id: true },
            take: 20,
          })
        ).map((row) => row.id)
      : [];

    const accessibleClientIds = new Set<string>(
      [user.clientId, ...emailMatchedClientIds].filter((value): value is string => Boolean(value))
    );

    const rows = (await listClientApprovals()).filter((row) => {
      if (accessibleClientIds.has(row.clientId)) return true;
      const metadata =
        row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null;
      const recipientUserIds = Array.isArray(metadata?.recipientUserIds)
        ? metadata!.recipientUserIds
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];
      if (recipientUserIds.includes(session.user.id)) return true;
      const recipientEmails = Array.isArray(metadata?.recipientEmails)
        ? metadata!.recipientEmails
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean)
        : [];
      return normalizedEmail ? recipientEmails.includes(normalizedEmail) : false;
    });

    const propertyIds = Array.from(
      new Set(rows.map((row) => row.propertyId).filter((value): value is string => Boolean(value)))
    );
    const jobIds = Array.from(
      new Set(rows.map((row) => row.jobId).filter((value): value is string => Boolean(value)))
    );

    const [properties, jobs] = await Promise.all([
      propertyIds.length
        ? db.property.findMany({
            where: { id: { in: propertyIds } },
            select: { id: true, name: true, suburb: true },
          })
        : Promise.resolve([]),
      jobIds.length
        ? db.job.findMany({
            where: { id: { in: jobIds } },
            select: {
              id: true,
              jobType: true,
              scheduledDate: true,
              property: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const propertyById = new Map(properties.map((row) => [row.id, row]));
    const jobById = new Map(jobs.map((row) => [row.id, row]));

    return NextResponse.json(
      rows.map((row) => ({
        ...row,
        property: row.propertyId ? propertyById.get(row.propertyId) ?? null : null,
        job: row.jobId ? jobById.get(row.jobId) ?? null : null,
      }))
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}
