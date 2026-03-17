import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  listClientDeliveryProfiles,
  upsertClientDeliveryProfile,
} from "@/lib/commercial/delivery-profiles";

const updateSchema = z.object({
  clientId: z.string().trim().min(1),
  reportRecipients: z.array(z.string().trim().email()).optional(),
  invoiceRecipients: z.array(z.string().trim().email()).optional(),
  autoSendReports: z.boolean().optional(),
  autoSendInvoices: z.boolean().optional(),
});

export async function GET() {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const [clients, profiles] = await Promise.all([
      db.client.findMany({
        where: { isActive: true },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
      listClientDeliveryProfiles(),
    ]);

    const profileByClientId = new Map(profiles.map((profile) => [profile.clientId, profile]));
    return NextResponse.json(
      clients.map((client) => {
        const profile = profileByClientId.get(client.id);
        return {
          client,
          profile: {
            clientId: client.id,
            reportRecipients:
              profile?.reportRecipients.length
                ? profile.reportRecipients
                : client.email
                  ? [client.email]
                  : [],
            invoiceRecipients:
              profile?.invoiceRecipients.length
                ? profile.invoiceRecipients
                : client.email
                  ? [client.email]
                  : [],
            autoSendReports: profile?.autoSendReports ?? false,
            autoSendInvoices: profile?.autoSendInvoices ?? false,
            updatedAt: profile?.updatedAt ?? null,
            updatedByUserId: profile?.updatedByUserId ?? null,
          },
        };
      })
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Request failed." }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const client = await db.client.findUnique({
      where: { id: body.clientId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const updated = await upsertClientDeliveryProfile({
      clientId: body.clientId,
      reportRecipients: body.reportRecipients,
      invoiceRecipients: body.invoiceRecipients,
      autoSendReports: body.autoSendReports,
      autoSendInvoices: body.autoSendInvoices,
      updatedByUserId: session.user.id,
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "DELIVERY_PROFILE_UPDATE",
        entity: "ClientDeliveryProfile",
        entityId: body.clientId,
        after: updated as any,
      },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Update failed." }, { status });
  }
}
