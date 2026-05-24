import { describe, it, expect } from "vitest";
import { parsePlaceResult } from "@/lib/google-maps/client";

describe("parsePlaceResult", () => {
  it("returns null for results without place_id", () => {
    const result = parsePlaceResult({} as any);
    expect(result).toBeNull();
  });

  it("extracts the canonical address shape from Sydney CBD example", () => {
    const fake: any = {
      place_id: "ChIJ-test",
      formatted_address: "1 George St, Sydney NSW 2000, Australia",
      geometry: { location: { lat: () => -33.8688, lng: () => 151.2093 } },
      address_components: [
        { types: ["street_number"], long_name: "1", short_name: "1" },
        { types: ["route"], long_name: "George Street", short_name: "George St" },
        { types: ["locality"], long_name: "Sydney", short_name: "Sydney" },
        { types: ["administrative_area_level_1"], long_name: "New South Wales", short_name: "NSW" },
        { types: ["postal_code"], long_name: "2000", short_name: "2000" },
        { types: ["country"], long_name: "Australia", short_name: "AU" },
      ],
    };
    const result = parsePlaceResult(fake);
    expect(result).toMatchObject({
      placeId: "ChIJ-test",
      formattedAddress: "1 George St, Sydney NSW 2000, Australia",
      streetNumber: "1",
      route: "George Street",
      suburb: "Sydney",
      state: "NSW",
      postcode: "2000",
      country: "AU",
      lat: -33.8688,
      lng: 151.2093,
    });
  });

  it("falls back to AU country when not specified", () => {
    const fake: any = {
      place_id: "ChIJ-test",
      formatted_address: "Some Address",
      geometry: { location: { lat: () => -33, lng: () => 151 } },
      address_components: [],
    };
    const result = parsePlaceResult(fake);
    expect(result?.country).toBe("AU");
  });
});
