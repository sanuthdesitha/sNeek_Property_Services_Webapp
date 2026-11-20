/**
 * The stay a found item belongs to, as the guest is told it: only what is
 * recorded, never a guessed date; the property name is not repeated.
 */
import { describe, expect, it } from "vitest";
import { formatStayDates, formatStayPlace, NO_STAY_DETAILS, stayDetailRows, stayDetailsText } from "@/lib/lost-found/stay-details";

const full = { guestName: " Gina Guest ", propertyName: "Bondi Studio", propertyAddress: "1 Sea St, Bondi, NSW 2026", checkIn: "2026-11-09", checkOut: "2026-11-12" };

describe("stay details", () => {
  it("lists guest, stay, property and address for the guest's page", () => {
    expect(stayDetailRows(full)).toEqual([
      { label: "Guest", value: "Gina Guest" },
      { label: "Stay", value: "9 November 2026 to 12 November 2026" },
      { label: "Property", value: "Bondi Studio" },
      { label: "Address", value: "1 Sea St, Bondi, NSW 2026" },
    ]);
  });

  it("leaves out what is not recorded and never invents a date", () => {
    expect(stayDetailRows(NO_STAY_DETAILS)).toEqual([]);
    expect(stayDetailsText(NO_STAY_DETAILS)).toBeNull();
    expect(stayDetailsText(null)).toBeNull();
    expect(formatStayDates({ checkIn: null, checkOut: null })).toBeNull();
    expect(formatStayDates({ checkIn: "not a date", checkOut: "2026-11-12" })).toBe("until 12 November 2026");
    expect(stayDetailsText({ ...NO_STAY_DETAILS, propertyName: "Bondi Studio" })).toBe("Your stay\nProperty: Bondi Studio");
  });

  it("does not repeat a property name the address already starts with", () => {
    expect(formatStayPlace({ propertyName: "1 Sea St", propertyAddress: "1 Sea St, Bondi, NSW 2026" })).toBe("1 Sea St, Bondi, NSW 2026");
    expect(formatStayPlace({ propertyName: "Bondi Studio", propertyAddress: null })).toBe("Bondi Studio");
  });

  it("has a one-line form for text messages", () => {
    expect(stayDetailsText(full, "compact")).toBe("Your stay: Gina Guest; 9 Nov 2026 to 12 Nov 2026; Bondi Studio, 1 Sea St, Bondi, NSW 2026.");
  });
});
