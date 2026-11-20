import "server-only";
/**
 * Reads the stay a found item belongs to (see ./stay-details). The guest name
 * is the one on the item (the office can correct it); the dates come from the
 * booking linked to the item and are null when no booking is linked.
 */
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { NO_STAY_DETAILS, type StayDetails } from "./stay-details";

type StayItem = { guestName: string | null; propertyId: string | null; reservationId: string | null };

function addressLine(property: { address: string; suburb: string; state: string; postcode: string | null }): string | null {
  const line = [property.address, property.suburb, [property.state, property.postcode].filter(Boolean).join(" ")].filter((part) => part && part.trim()).join(", ");
  return line || null;
}

export async function loadStayDetails(item: StayItem, timeZone: string): Promise<StayDetails> {
  const [property, booking] = await Promise.all([
    item.propertyId ? db.property.findUnique({ where: { id: item.propertyId }, select: { name: true, address: true, suburb: true, state: true, postcode: true } }) : null,
    item.reservationId ? db.reservation.findUnique({ where: { id: item.reservationId }, select: { startDate: true, endDate: true } }) : null,
  ]);
  return {
    ...NO_STAY_DETAILS,
    guestName: item.guestName?.trim() || null,
    propertyName: property?.name?.trim() || null,
    propertyAddress: property ? addressLine(property) : null,
    checkIn: booking ? formatInTimeZone(booking.startDate, timeZone, "yyyy-MM-dd") : null,
    checkOut: booking ? formatInTimeZone(booking.endDate, timeZone, "yyyy-MM-dd") : null,
  };
}

/** By item id, for callers that hold only the id. */
export async function loadStayDetailsForItem(itemId: string, timeZone: string): Promise<StayDetails> {
  const item = await db.lostFoundItem.findUnique({ where: { id: itemId }, select: { guestName: true, propertyId: true, reservationId: true } });
  return item ? loadStayDetails(item, timeZone) : NO_STAY_DETAILS;
}
