import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * List the current user's enrolled biometric devices.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const creds = await db.webAuthnCredential.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceName: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json({
      devices: creds.map((c) => ({
        id: c.id,
        deviceName: c.deviceName ?? "Trusted device",
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
      })),
    });
  } catch (err: any) {
    const status = err?.message === "UNAUTHORIZED" ? 401 : err?.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json(
      { error: err?.message ?? "Could not load devices." },
      { status }
    );
  }
}
