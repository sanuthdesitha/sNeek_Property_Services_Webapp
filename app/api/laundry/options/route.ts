import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER, Role.LAUNDRY, Role.CLEANER]);
    const settings = await getAppSettings();
    const suppliers = await db.laundrySupplier.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        pricePerKg: true,
        avgTurnaround: true,
      },
    });
    return NextResponse.json({
      bagLocationOptions: settings.laundryBagLocationOptions,
      dropoffLocationOptions: settings.laundryDropoffLocationOptions,
      portalVisibility: settings.laundryPortalVisibility,
      operations: settings.laundryOperations,
      branding: {
        companyName: settings.companyName,
        logoUrl: settings.logoUrl,
      },
      viewerName: session.user.name ?? session.user.email ?? "Laundry Team",
      timezone: settings.timezone || "Australia/Sydney",
      suppliers,
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
