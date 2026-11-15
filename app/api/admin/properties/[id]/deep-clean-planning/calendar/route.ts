import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { deepCleanDayMarks } from "@/lib/properties/deep-clean-queue";

const rangeSchema = z.object({ from: z.string().date(), to: z.string().date() });
const MAX_RANGE_DAYS = 120;

/**
 * Guests-staying and turnover marks for the deep-clean date panel, from
 * stored bookings and jobs. Read only; ADMIN and OPS_MANAGER (Properties
 * pack, middleware), live role guard.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
  const range = rangeSchema.safeParse({ from: req.nextUrl.searchParams.get("from"), to: req.nextUrl.searchParams.get("to") });
  if (!range.success || range.data.from > range.data.to) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  const days = (Date.parse(range.data.to) - Date.parse(range.data.from)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) return NextResponse.json({ error: "Choose a shorter date range." }, { status: 400 });
  try {
    const property = await db.property.findUnique({ where: { id: params.id }, select: { isActive: true } });
    if (!property?.isActive) return NextResponse.json({ error: "Active property not found." }, { status: 404 });
    return NextResponse.json(await deepCleanDayMarks(params.id, range.data.from, range.data.to));
  } catch {
    return NextResponse.json({ error: "Bookings could not be read." }, { status: 500 });
  }
}
