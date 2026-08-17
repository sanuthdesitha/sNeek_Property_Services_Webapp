import { fromZonedTime } from "date-fns-tz";
import { JobStatus, LeadStatus, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { getAppSettings } from "@/lib/settings";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { calculateQuote } from "@/lib/pricing/calculator";
import { notifyAdminsByEmail, notifyAdminsByPush } from "@/lib/notifications/admin-alerts";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";

const TZ = "Australia/Sydney";

const schema = z.object({
  propertyId: z.string().trim().min(1),
  jobType: z.string().trim().min(1),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    // Booking creates work and spends the client's money, so a VA needs the
    // `bookings` grant. requireClientPortal guarantees a clientId.
    const portal = await requireClientPortal({ permission: "bookings" });
    const settings = await getAppSettings();
    if (!isClientModuleEnabled(portal.visibility, "booking")) {
      return NextResponse.json({ error: "Booking is disabled for this client." }, { status: 403 });
    }

    const body = schema.parse(await req.json().catch(() => ({})));
    const clientUser = await db.user.findUnique({
      where: { id: portal.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        clientId: true,
        client: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    // The signed-in user row must exist. Note this no longer requires
    // user.clientId — a VA has none, and the client comes from portal.clientId.
    if (!clientUser) {
      return NextResponse.json({ error: "Account not found." }, { status: 400 });
    }

    const property = await db.property.findFirst({
      where: {
        id: body.propertyId,
        // The PORTAL's clientId, not the user row's — a VA has no
        // user.clientId and would otherwise never match.
        clientId: portal.clientId,
        isActive: true,
        // ANDed, not spread: `{ id: { in: scope } }` at this level would
        // OVERWRITE `id: body.propertyId` and let a scoped VA book any of the
        // client's properties.
        ...(portal.propertyIds ? { AND: [{ id: { in: portal.propertyIds } }] } : {}),
      },
      select: {
        id: true,
        name: true,
        suburb: true,
        address: true,
        bedrooms: true,
        bathrooms: true,
      },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }

    const estimate = await calculateQuote({
      serviceType: body.jobType as any,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
    }).catch(() => null);

    const scheduledDateUtc = fromZonedTime(`${body.scheduledDate}T00:00:00`, TZ);

    const result = await db.$transaction(async (tx) => {
      const lead = await tx.quoteLead.create({
        data: {
          clientId: clientUser.clientId,
          serviceType: body.jobType as any,
          name: clientUser.client?.name || clientUser.name || "Client",
          email: clientUser.client?.email || clientUser.email || "",
          phone: clientUser.client?.phone || clientUser.phone || undefined,
          address: property.address,
          suburb: property.suburb,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          notes: body.notes || undefined,
          estimateMin: estimate ? Number(estimate.total.toFixed(2)) : undefined,
          estimateMax: estimate ? Number(estimate.total.toFixed(2)) : undefined,
          requestedServiceLabel: String(body.jobType).replace(/_/g, " "),
          status: LeadStatus.CONVERTED,
          structuredContext: {
            createdVia: "client_booking",
            propertyId: property.id,
          } as any,
        },
      });

      const jobNumber = await reserveJobNumber(tx);
      const job = await tx.job.create({
        data: {
          jobNumber,
          propertyId: property.id,
          jobType: body.jobType as any,
          status: JobStatus.UNASSIGNED,
          scheduledDate: scheduledDateUtc,
          notes: body.notes || undefined,
        },
        select: {
          id: true,
          jobNumber: true,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: portal.userId,
          jobId: job.id,
          action: "CLIENT_SELF_BOOKING_CREATED",
          entity: "Job",
          entityId: job.id,
          after: {
            leadId: lead.id,
            propertyId: property.id,
            jobType: body.jobType,
            scheduledDate: body.scheduledDate,
          } as any,
        },
      });

      return { lead, job };
    });

    const subject = `New client booking request: ${property.name}`;
    const bookingLabel = `${String(body.jobType).replace(/_/g, " ")} on ${body.scheduledDate}`;
    await Promise.all([
      notifyAdminsByPush({
        subject,
        body: `${clientUser.client?.name || clientUser.name || "Client"} requested ${bookingLabel} for ${property.name}.`,
        jobId: result.job.id,
      }),
      notifyAdminsByEmail({
        subject,
        html: `
          <p>A client self-serve booking was created.</p>
          <ul>
            <li><strong>Client:</strong> ${clientUser.client?.name || clientUser.name || "Client"}</li>
            <li><strong>Property:</strong> ${property.name}</li>
            <li><strong>Service:</strong> ${String(body.jobType).replace(/_/g, " ")}</li>
            <li><strong>Date:</strong> ${body.scheduledDate}</li>
            ${body.notes ? `<li><strong>Notes:</strong> ${body.notes}</li>` : ""}
          </ul>
        `,
      }),
    ]);
    await assignPreferredCleanerIfAvailable({
      jobId: result.job.id,
      propertyId: property.id,
      jobType: body.jobType as any,
    });

    return NextResponse.json({
      ok: true,
      jobId: result.job.id,
      jobNumber: result.job.jobNumber,
      warning:
        settings.clientPortalVisibility.showBooking
          ? undefined
          : "Booking access is currently hidden from the portal.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create booking." },
      { status: error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
