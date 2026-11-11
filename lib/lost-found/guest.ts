/**
 * Guest details on a lost and found item.
 *
 * `Job.reservation` is the DEPARTING guest (the booking whose checkout made
 * the turnover), which is who most likely left the item. When an item is
 * logged against a job, that booking's guest name, phone and email are copied
 * onto the item with `guestSource` BOOKING and the booking is linked, so its
 * stay dates, party, booking code and source stay readable. A job with no
 * booking copies nothing ("No booking on job") — nothing is invented.
 *
 * An office edit sets MANUAL. Nothing automatic ever writes guest fields on an
 * item after it is created; the only other write is the office explicitly
 * choosing a different booking. Pure.
 */
import { buildGuestCountLabel, telHref } from "@/lib/jobs/guest-summary";
import type { LostFoundGuestSource } from "./status";

export type BookingGuest = {
  id: string;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
};

export type ItemGuestFields = {
  guestName: string | null;
  guestContact: string | null;
  guestEmail: string | null;
  reservationId: string | null;
  guestSource: LostFoundGuestSource | null;
};

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** What an item takes from its job's booking. Null when the job has none. */
export function guestFieldsFromBooking(booking: BookingGuest | null | undefined): ItemGuestFields | null {
  if (!booking) return null;
  return {
    guestName: clean(booking.guestName),
    guestContact: clean(booking.guestPhone),
    guestEmail: clean(booking.guestEmail),
    reservationId: booking.id,
    guestSource: "BOOKING",
  };
}

export type GuestEdit = {
  guestName?: string | null;
  guestContact?: string | null;
  guestEmail?: string | null;
};

/** An office edit of any guest field: the values typed, marked MANUAL. */
export function guestEditPatch(edit: GuestEdit): Partial<ItemGuestFields> | null {
  const patch: Partial<ItemGuestFields> = {};
  if (edit.guestName !== undefined) patch.guestName = clean(edit.guestName);
  if (edit.guestContact !== undefined) patch.guestContact = clean(edit.guestContact);
  if (edit.guestEmail !== undefined) patch.guestEmail = clean(edit.guestEmail);
  if (Object.keys(patch).length === 0) return null;
  return { ...patch, guestSource: "MANUAL" };
}

export type BookingSummary = {
  id: string;
  guestName: string | null;
  guestPhone: string | null;
  guestEmail: string | null;
  reservationCode: string | null;
  source: string | null;
  startDate: string;
  endDate: string;
  partyLabel: string | null;
};

export type BookingRecord = BookingGuest & {
  reservationCode: string | null;
  source: string | null;
  startDate: Date;
  endDate: Date;
  adults: number | null;
  children: number | null;
  infants: number | null;
};

export function bookingSummary(booking: BookingRecord): BookingSummary {
  return {
    id: booking.id,
    guestName: clean(booking.guestName),
    guestPhone: clean(booking.guestPhone),
    guestEmail: clean(booking.guestEmail),
    reservationCode: clean(booking.reservationCode),
    source: clean(booking.source),
    startDate: booking.startDate.toISOString(),
    endDate: booking.endDate.toISOString(),
    partyLabel: buildGuestCountLabel(booking),
  };
}

/** A usable phone number inside free-text contact, for tel:/sms: links. */
export function phoneFromContact(contact: string | null | undefined): string | null {
  const match = contact?.match(/\+?[\d][\d\s().-]{5,}\d/);
  return match ? telHref(match[0]) : null;
}

/** An email address inside free-text contact. */
export function emailFromContact(contact: string | null | undefined): string | null {
  const match = contact?.match(/[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+/);
  return match ? match[0] : null;
}
