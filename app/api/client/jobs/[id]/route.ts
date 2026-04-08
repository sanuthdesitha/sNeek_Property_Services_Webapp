import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";

const STALE_LIVE_PING_MS = 2 * 60 * 1000;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireRole([Role.CLIENT]);

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { clientId: true },
  });
  if (!user?.clientId) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  const clientId = user.clientId;

  const job = await db.job.findFirst({
    where: { id: params.id, property: { clientId } },
    select: {
      id: true,
      jobNumber: true,
      jobType: true,
      status: true,
      scheduledDate: true,
      startTime: true,
      endTime: true,
      dueTime: true,
      notes: true,
      actualHours: true,
      estimatedHours: true,
      enRouteStartedAt: true,
      enRouteEtaMinutes: true,
      enRouteEtaUpdatedAt: true,
      drivingPausedAt: true,
      drivingPauseReason: true,
      drivingDelayedAt: true,
      drivingDelayedReason: true,
      arrivedAt: true,
      cleanerLocationPings: {
        where: { timestamp: { gte: new Date(Date.now() - STALE_LIVE_PING_MS) } },
        orderBy: { timestamp: "desc" },
        take: 1,
        select: { lat: true, lng: true, accuracy: true, heading: true, speed: true, timestamp: true },
      },
      property: {
        select: {
          id: true,
          name: true,
          address: true,
          suburb: true,
          state: true,
          postcode: true,
          latitude: true,
          longitude: true,
          showCleanerContactToClient: true,
        },
      },
      assignments: {
        where: { removedAt: null },
        select: {
          isPrimary: true,
          user: { select: { id: true, name: true, image: true, phone: true } },
        },
      },
      laundryTask: {
        select: {
          id: true,
          status: true,
          pickupDate: true,
          dropoffDate: true,
          pickedUpAt: true,
          droppedAt: true,
          noPickupRequired: true,
          skipReasonCode: true,
          skipReasonNote: true,
          confirmations: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              createdAt: true,
              laundryReady: true,
              bagLocation: true,
              photoUrl: true,
              notes: true,
            },
          },
        },
      },
      invoiceLines: {
        select: {
          id: true,
          description: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              totalAmount: true,
              sentAt: true,
            },
          },
        },
      },
      report: {
        select: {
          id: true,
          pdfUrl: true,
          sentAt: true,
          clientVisible: true,
          generatedAt: true,
          createdAt: true,
        },
      },
      satisfactionRating: {
        select: { score: true, comment: true, createdAt: true },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          action: true,
          entity: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      },
    },
  });

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // Strip phone numbers unless admin has enabled cleaner contact visibility for this property
  const showContact = job.property.showCleanerContactToClient;
  const latestPing = job.cleanerLocationPings[0] ?? null;
  const sanitizedJob = {
    ...job,
    liveTrip:
      job.status === "EN_ROUTE"
        ? {
            cleanerLat: latestPing?.lat ?? null,
            cleanerLng: latestPing?.lng ?? null,
            accuracy: latestPing?.accuracy ?? null,
            heading: latestPing?.heading ?? null,
            speed: latestPing?.speed ?? null,
            lastPingAt: latestPing?.timestamp ?? null,
            propertyLat: job.property.latitude ?? null,
            propertyLng: job.property.longitude ?? null,
          }
        : null,
    assignments: job.assignments.map((assignment) => ({
      ...assignment,
      user: {
        id: assignment.user.id,
        name: assignment.user.name,
        image: assignment.user.image,
        ...(showContact ? { phone: assignment.user.phone } : {}),
      },
    })),
  };

  return NextResponse.json(sanitizedJob);
}
