import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bookingSummary } from "@/lib/lost-found/guest";

const BEFORE_DAYS = 21;
const AFTER_DAYS = 3;

/**
 * GET — "Pick another booking at this property": the property's bookings that
 * ended between 21 days before and 3 days after the item was found (the guests
 * who could have left it), nearest checkout first.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const item = await db.lostFoundItem.findUnique({ where: { id: params.id }, select: { propertyId: true, createdAt: true, reservationId: true } });
    if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });
    if (!item.propertyId) return NextResponse.json({ bookings: [], currentId: item.reservationId });
    const found = item.createdAt.getTime();
    const bookings = await db.reservation.findMany({
      where: { propertyId: item.propertyId, endDate: { gte: new Date(found - BEFORE_DAYS * 86_400_000), lte: new Date(found + AFTER_DAYS * 86_400_000) } },
      select: { id: true, guestName: true, guestPhone: true, guestEmail: true, reservationCode: true, source: true, startDate: true, endDate: true, adults: true, children: true, infants: true },
      take: 40,
    });
    const nearest = bookings.sort((a, b) => Math.abs(a.endDate.getTime() - found) - Math.abs(b.endDate.getTime() - found));
    return NextResponse.json({ bookings: nearest.map(bookingSummary), currentId: item.reservationId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load bookings.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
