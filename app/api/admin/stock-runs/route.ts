import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { listStockRuns, createStockRun } from "@/lib/inventory/stock-runs";

const createSchema = z.object({
  propertyId: z.string().trim().min(1),
  title: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function GET() {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
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
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = createSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(
      await createStockRun(
        { role: session.user.role as Role, userId: session.user.id },
        { ...body, requestedByAdmin: true }
      )
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not create stock run." }, { status });
  }
}
