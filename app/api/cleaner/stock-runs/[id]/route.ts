import { NextRequest, NextResponse } from "next/server";
import { Role, StockRunStatus } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { isCleanerModuleEnabled } from "@/lib/portal-access";
import { getStockRun, updateStockRun } from "@/lib/inventory/stock-runs";
import { notifyStockRunSubmitted } from "@/lib/inventory/notifications";

const patchSchema = z.object({
  title: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
  status: z.nativeEnum(StockRunStatus).optional(),
  lines: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        countedOnHand: z.number().min(0).optional().nullable(),
        note: z.string().trim().max(500).optional().nullable(),
      })
    )
    .optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    if (session.user.role === Role.CLEANER && !isCleanerModuleEnabled(settings, "stockRuns")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      await getStockRun({ role: session.user.role as Role, userId: session.user.id }, params.id)
    );
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.message === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: err.message ?? "Could not load stock run." }, { status });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole([Role.CLEANER, Role.ADMIN, Role.OPS_MANAGER]);
    const settings = await getAppSettings();
    if (session.user.role === Role.CLEANER && !isCleanerModuleEnabled(settings, "stockRuns")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = patchSchema.parse(await req.json().catch(() => ({})));
    const current = await getStockRun({ role: session.user.role as Role, userId: session.user.id }, params.id);
    const updated = await updateStockRun({ role: session.user.role as Role, userId: session.user.id }, params.id, body);
    if (body.status === StockRunStatus.SUBMITTED && current.status !== StockRunStatus.SUBMITTED) {
      await notifyStockRunSubmitted({
        run: updated,
        actorLabel: session.user.name || session.user.email || "Cleaner",
      });
    }
    return NextResponse.json(updated);
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : err.message === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: err.message ?? "Could not update stock run." }, { status });
  }
}
