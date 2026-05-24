import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth/auth-options";
import { db } from "@/lib/db";

const schema = z.object({
  notificationsEnabled: z.boolean().optional(),
  notifyOnEnRoute: z.boolean().optional(),
  notifyOnJobStart: z.boolean().optional(),
  notifyOnJobComplete: z.boolean().optional(),
  preferredChannel: z.enum(["EMAIL", "SMS", "BOTH"]).optional(),
});

async function getCurrentClientId() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { clientId: true, role: true },
  });
  if (!user || user.role !== "CLIENT" || !user.clientId) return null;
  return user.clientId;
}

export async function GET() {
  const clientId = await getCurrentClientId();
  if (!clientId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const pref = await db.clientNotificationPreference.findUnique({
    where: { clientId },
  });
  return NextResponse.json(
    pref ?? {
      clientId,
      notificationsEnabled: true,
      notifyOnEnRoute: true,
      notifyOnJobStart: true,
      notifyOnJobComplete: true,
      preferredChannel: "EMAIL",
    },
  );
}

export async function PATCH(req: NextRequest) {
  const clientId = await getCurrentClientId();
  if (!clientId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid" }, { status: 400 });
  }
  const data = parsed.data;
  const pref = await db.clientNotificationPreference.upsert({
    where: { clientId },
    create: {
      clientId,
      notificationsEnabled: data.notificationsEnabled ?? true,
      notifyOnEnRoute: data.notifyOnEnRoute ?? true,
      notifyOnJobStart: data.notifyOnJobStart ?? true,
      notifyOnJobComplete: data.notifyOnJobComplete ?? true,
      preferredChannel: data.preferredChannel ?? "EMAIL",
    },
    update: data,
  });
  return NextResponse.json(pref);
}
