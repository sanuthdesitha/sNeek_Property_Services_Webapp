import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getAppSettings, saveAppSettings } from "@/lib/settings";

const schema = z.object({
  auditId: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN]);
    const body = schema.parse(await req.json());

    const auditEntry = await db.auditLog.findFirst({
      where: {
        id: body.auditId,
        entity: "AppSettings",
        entityId: "app",
      },
      select: {
        id: true,
        after: true,
      },
    });

    if (!auditEntry?.after || typeof auditEntry.after !== "object") {
      return NextResponse.json({ error: "No restorable settings snapshot was found." }, { status: 400 });
    }

    const before = await getAppSettings();
    const restored = await saveAppSettings(auditEntry.after as any);

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "SETTINGS_RESTORE",
        entity: "AppSettings",
        entityId: "app",
        before: before as any,
        after: restored as any,
        ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
      },
    });

    return NextResponse.json(restored);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
