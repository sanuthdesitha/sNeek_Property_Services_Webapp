"use client";

import { AddressSearchInput } from "@/components/shared/address-search-input";

type AddressParts = {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
};

type GoogleAddressInputProps = {
  id?: string;
  value: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onResolved?: (parts: AddressParts) => void;
};

function getNewComponent(
  place: any,
  type: string,
  mode: "longText" | "shortText" = "longText",
): string {
  const match = (place?.addressComponents ?? []).find(
    (part: any) => Array.isArray(part.types) && part.types.includes(type),
  );
  return match?.[mode] ?? match?.[mode === "longText" ? "long_name" : "short_name"] ?? "";
}

function parseNewPlaceToParts(place: any): AddressParts {
  const subpremise = getNewComponent(place, "subpremise"); // unit / apartment no.
  const streetNumber = getNewComponent(place, "street_number");
  const route = getNewComponent(place, "route");
  const suburb =
    getNewComponent(place, "locality") ||
    getNewComponent(place, "postal_town") ||
    getNewComponent(place, "sublocality_level_1") ||
    getNewComponent(place, "administrative_area_level_2");
  const state = getNewComponent(place, "administrative_area_level_1", "shortText");
  const postcode = getNewComponent(place, "postal_code");

  // AU street line keeps the unit + street number: "5/12 Main Street".
  const numberPart = [subpremise, streetNumber].filter(Boolean).join("/");
  const reassembled = [numberPart, route].filter(Boolean).join(" ").trim();
  // Fall back to the street segment of the formatted address (which always
  // includes the unit + number) when the structured components are incomplete —
  // this is what previously saved "just the street" with no number.
  const formatted = typeof place?.formattedAddress === "string" ? place.formattedAddress : "";
  const formattedStreet = formatted ? formatted.split(",")[0]?.trim() ?? "" : "";
  const streetAddress = reassembled || formattedStreet;

  const loc = place?.location;
  const lat =
    typeof loc?.lat === "function" ? loc.lat() : typeof loc?.lat === "number" ? loc.lat : undefined;
  const lng =
    typeof loc?.lng === "function" ? loc.lng() : typeof loc?.lng === "number" ? loc.lng : undefined;
  const placeId = typeof place?.id === "string" ? place.id : undefined;

  return {
    address: streetAddress || place?.displayName?.text || place?.formattedAddress || "",
    suburb,
    state,
    postcode,
    formattedAddress: place?.formattedAddress || "",
    lat,
    lng,
    placeId,
  };
}

/**
 * Public-shape Google address input. Thin adapter over the themed
 * {@link AddressSearchInput} — keeps the previous (value / onChange / onResolved)
 * contract so every existing form keeps working, but now renders our own themed
 * suggestion dropdown and stays a normal, re-searchable text field.
 */
export function GoogleAddressInput({
  id,
  value,
  placeholder,
  className,
  disabled,
  onChange,
  onResolved,
}: GoogleAddressInputProps) {
  return (
    <AddressSearchInput
      id={id}
      value={value}
      placeholder={placeholder ?? "Start typing an address…"}
      className={className}
      disabled={disabled}
      onChange={onChange}
      onPlaceSelected={(place) => {
        const parts = parseNewPlaceToParts(place);
        if (parts.address) onChange(parts.address);
        onResolved?.(parts);
      }}
    />
  );
}
