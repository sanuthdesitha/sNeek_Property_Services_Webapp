import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { notifyAdminsByEmail, notifyAdminsByPush } from "@/lib/notifications/admin-alerts";

const schema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!portal.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }

    const rows = await db.clientMessage.findMany({
      where: { clientId: portal.clientId },
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
        isFromAdmin: true,
        isRead: false,
      },
      data: { isRead: true },
    });

    return NextResponse.json(rows);
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load messages." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    const portal = await getClientPortalContext(session.user.id, settings);
    if (!portal.clientId) {
      return NextResponse.json({ error: "Client profile missing." }, { status: 400 });
    }

    const body = schema.parse(await req.json().catch(() => ({})));
    const client = await db.client.findUnique({
      where: { id: portal.clientId },
      select: { id: true, name: true },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const message = await db.clientMessage.create({
      data: {
        clientId: client.id,
        sentById: session.user.id,
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

    await Promise.all([
      notifyAdminsByPush({
        subject: "New client message",
        body: `${client.name} sent a new message in the client portal.`,
      }),
      notifyAdminsByEmail({
        subject: `New client message from ${client.name}`,
        html: `<p><strong>${client.name}</strong> sent a new portal message.</p><p>${body.body}</p>`,
      }),
    ]);

    return NextResponse.json(message, { status: 201 });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send message." }, { status });
  }
}
