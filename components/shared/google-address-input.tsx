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
  const streetNumber = getNewComponent(place, "street_number");
  const route = getNewComponent(place, "route");
  const suburb =
    getNewComponent(place, "locality") ||
    getNewComponent(place, "postal_town") ||
    getNewComponent(place, "sublocality_level_1") ||
    getNewComponent(place, "administrative_area_level_2");
  const state = getNewComponent(place, "administrative_area_level_1", "shortText");
  const postcode = getNewComponent(place, "postal_code");
  const streetAddress = [streetNumber, route].filter(Boolean).join(" ").trim();

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
