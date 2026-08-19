import { LeadStatus, Role } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { BOOKING_REQUEST_VIA } from "@/lib/booking/requests";
import { getAppSettings } from "@/lib/settings";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { calculateQuote } from "@/lib/pricing/calculator";
import { notifyAdminsByEmail, notifyAdminsByPush } from "@/lib/notifications/admin-alerts";


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
          // NEW, not CONVERTED: nothing has been committed to yet. The lead IS
          // the pending request, and CONVERTED is what approval means.
          status: LeadStatus.NEW,
          structuredContext: {
            createdVia: BOOKING_REQUEST_VIA,
            propertyId: property.id,
            // Everything the approval needs to build the job, so approving
            // never has to re-derive what the client actually asked for.
            jobType: body.jobType,
            scheduledDate: body.scheduledDate,
            requestedByUserId: portal.userId,
          } as any,
        },
      });

      // No Job here. A booking nobody has agreed to is not work — it appeared
      // on the jobs board looking exactly like scheduled work, and sat
      // UNASSIGNED until someone happened to notice. The job is created by
      // approveBookingRequest once an admin has seen team availability.
      await tx.auditLog.create({
        data: {
          userId: portal.userId,
          action: "CLIENT_BOOKING_REQUESTED",
          entity: "QuoteLead",
          entityId: lead.id,
          after: {
            propertyId: property.id,
            jobType: body.jobType,
            scheduledDate: body.scheduledDate,
          } as any,
        },
      });

      return { lead };
    });

    const subject = `Booking request awaiting approval: ${property.name}`;
    const bookingLabel = `${String(body.jobType).replace(/_/g, " ")} on ${body.scheduledDate}`;
    await Promise.all([
      notifyAdminsByPush({
        subject,
        body: `${clientUser.client?.name || clientUser.name || "Client"} requested ${bookingLabel} for ${property.name}. Approve it to create the job.`,
      }),
      notifyAdminsByEmail({
        subject,
        html: `
          <p>A client requested a booking. It is <strong>not scheduled yet</strong> — approve it in Approvals to create the job.</p>
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
    // Preferred-cleaner assignment waits for approval: there is no job to
    // assign anyone to, and holding a cleaner for work that may be declined is
    // exactly the double-booking this change exists to stop.

    return NextResponse.json({
      ok: true,
      requestId: result.lead.id,
      pendingApproval: true,
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
