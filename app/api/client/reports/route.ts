import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getAppSettings } from "@/lib/settings";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { getApiErrorStatus } from "@/lib/api/http";

export async function GET() {
  try {
    const session = await requireRole([Role.CLIENT]);
    const settings = await getAppSettings();
    if (!isClientModuleEnabled(settings, "reports")) {
      return NextResponse.json({ error: "Reports are not available for client users." }, { status: 403 });
    }
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { clientId: true },
    });
    if (!user?.clientId) return NextResponse.json([]);

    const reports = await db.report.findMany({
      where: {
        // Only reports an admin explicitly published to the client. Without this
        // a client could pull reports marked clientVisible=false (incl. their
        // embedded QA/notes HTML).
        clientVisible: true,
        job: {
          property: { clientId: user.clientId },
          status: { in: ["COMPLETED", "INVOICED"] },
        },
      },
      // Return only client-safe fields (no internal columns).
      select: {
        id: true,
        jobId: true,
        pdfUrl: true,
        htmlContent: true,
        clientVisible: true,
        createdAt: true,
        job: {
          select: {
            scheduledDate: true,
            jobType: true,
            property: { select: { name: true, suburb: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(reports);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: getApiErrorStatus(err) });
  }
}
