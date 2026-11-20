/**
 * The stay a found item belongs to, as the guest is told it (2026-11-20):
 * guest name, stay dates, property name and address. Every guest message and
 * the guest's page carry these so the guest can tell which stay it is about.
 *
 * Pure. A detail that is not recorded is left out, never guessed: the stay
 * dates come only from the booking linked to the item.
 */

export type StayDetails = {
  guestName: string | null;
  propertyName: string | null;
  /** Street address, suburb, state and postcode on one line. */
  propertyAddress: string | null;
  /** Calendar dates (YYYY-MM-DD) in the organisation's calendar. */
  checkIn: string | null;
  checkOut: string | null;
};

export const NO_STAY_DETAILS: StayDetails = { guestName: null, propertyName: null, propertyAddress: null, checkIn: null, checkOut: null };

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function formatDay(day: string, style: "long" | "short"): string {
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: style, year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

function validDay(day: string | null): string | null {
  return day && DAY_PATTERN.test(day) ? day : null;
}

/** "9 November 2026 to 12 November 2026", one known date in words, or null. */
export function formatStayDates(details: Pick<StayDetails, "checkIn" | "checkOut">, style: "long" | "short" = "long"): string | null {
  const checkIn = validDay(details.checkIn);
  const checkOut = validDay(details.checkOut);
  if (checkIn && checkOut) return `${formatDay(checkIn, style)} to ${formatDay(checkOut, style)}`;
  if (checkIn) return `from ${formatDay(checkIn, style)}`;
  if (checkOut) return `until ${formatDay(checkOut, style)}`;
  return null;
}

/** Property name and address on one line, without repeating the name. */
export function formatStayPlace(details: Pick<StayDetails, "propertyName" | "propertyAddress">): string | null {
  const name = details.propertyName?.trim() || null;
  const address = details.propertyAddress?.trim() || null;
  if (name && address) return address.toLowerCase().startsWith(name.toLowerCase()) ? address : `${name}, ${address}`;
  return name ?? address;
}

export type StayDetailRow = { label: "Guest" | "Stay" | "Property" | "Address"; value: string };

/** The rows the guest's page shows; only what is recorded. */
export function stayDetailRows(details: StayDetails): StayDetailRow[] {
  const rows: StayDetailRow[] = [];
  const guest = details.guestName?.trim();
  const dates = formatStayDates(details);
  const name = details.propertyName?.trim();
  const address = details.propertyAddress?.trim();
  if (guest) rows.push({ label: "Guest", value: guest });
  if (dates) rows.push({ label: "Stay", value: dates });
  if (name) rows.push({ label: "Property", value: name });
  if (address) rows.push({ label: "Address", value: address });
  return rows;
}

/**
 * The block a guest message carries, or null when nothing is recorded.
 * "compact" is one line with short dates, for a text message.
 */
export function stayDetailsText(details: StayDetails | null | undefined, form: "full" | "compact" = "full"): string | null {
  if (!details) return null;
  const guest = details.guestName?.trim() || null;
  const place = formatStayPlace(details);
  if (form === "compact") {
    const parts = [guest, formatStayDates(details, "short"), place].filter(Boolean);
    return parts.length ? `Your stay: ${parts.join("; ")}.` : null;
  }
  const dates = formatStayDates(details);
  const lines = [guest ? `Guest: ${guest}` : null, dates ? `Stay: ${dates}` : null, place ? `Property: ${place}` : null].filter(Boolean);
  return lines.length ? `Your stay\n${lines.join("\n")}` : null;
}
