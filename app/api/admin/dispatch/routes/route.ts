import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { buildDailyRoutePlan } from "@/lib/ops/dispatch";

const querySchema = z.object({
  date: z.string().date(),
});

export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { searchParams } = new URL(req.url);
    const { date } = querySchema.parse({
      date: searchParams.get("date") ?? new Date().toISOString().slice(0, 10),
    });
    const routes = await buildDailyRoutePlan(date);
    return NextResponse.json({ date, routes });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not build route plan." }, { status });
  }
}

