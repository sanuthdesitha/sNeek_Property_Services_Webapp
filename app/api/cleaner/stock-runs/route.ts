import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { createStockRun, listStockRuns } from "@/lib/inventory/stock-runs";
import { notifyStockRunRequested } from "@/lib/inventory/notifications";

const createSchema = z.object({
  propertyId: z.string().trim().min(1),
  title: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function GET() {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    if (session.user.role === Role.CLEANER && !isCleanerModuleEnabled(settings, "stockRuns")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      await listStockRuns({ role: session.user.role as Role, userId: session.user.id })
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load stock runs." }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    if (session.user.role === Role.CLEANER && !isCleanerModuleEnabled(settings, "stockRuns")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = createSchema.parse(await req.json().catch(() => ({})));
    const created = await createStockRun({ role: session.user.role as Role, userId: session.user.id }, body);
    if (session.user.role === Role.CLEANER) {
      await notifyStockRunRequested({
        run: created,
        actorLabel: session.user.name || session.user.email || "Cleaner",
      });
    }
    return NextResponse.json(created);
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create stock run." }, { status });
  }
}
