import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deliverNotificationToRecipients } from "@/lib/notifications/delivery";

const schema = z.object({
  clientId: z.string().cuid(),
  body: z.string().trim().min(1).max(4000),
});

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const clientId = req.nextUrl.searchParams.get("clientId")?.trim() || "";

    const clients = await db.client.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            body: true,
            createdAt: true,
            isFromAdmin: true,
            isRead: true,
          },
        },
        _count: {
          select: {
            messages: {
              where: {
                isFromAdmin: false,
                isRead: false,
              },
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    const messages = clientId
      ? await db.clientMessage.findMany({
          where: { clientId },
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
        })
      : [];

    if (clientId) {
      await db.clientMessage.updateMany({
        where: {
          clientId,
          isFromAdmin: false,
          isRead: false,
        },
        data: { isRead: true },
      });
    }

    return NextResponse.json({ clients, messages });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not load messages." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = schema.parse(await req.json().catch(() => ({})));
    const client = await db.client.findUnique({
      where: { id: body.clientId },
      select: {
        id: true,
        name: true,
        users: {
          where: { isActive: true },
          select: {
            id: true,
            role: true,
            email: true,
            phone: true,
            name: true,
          },
        },
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const message = await db.clientMessage.create({
      data: {
        clientId: client.id,
        sentById: session.user.id,
        body: body.body,
        isFromAdmin: true,
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

    if (client.users.length > 0) {
      await deliverNotificationToRecipients({
        recipients: client.users,
        category: "account",
        web: {
          subject: "New admin message",
          body: `${client.name} has a new message in the portal.`,
        },
        email: {
          subject: `New message from sNeek`,
          html: `<p>You have a new message from the sNeek team.</p><p>${body.body}</p>`,
        },
      });
    }

    return NextResponse.json(message, { status: 201 });
  } catch (error: any) {
    const status =
      error?.message === "UNAUTHORIZED" ? 401 : error?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: error?.message ?? "Could not send message." }, { status });
  }
}
