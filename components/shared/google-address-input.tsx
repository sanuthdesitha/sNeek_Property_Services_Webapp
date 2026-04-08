"use client";

import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";
import { ensureGoogleMaps } from "@/lib/maps/loader";

type AddressParts = {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  formattedAddress?: string;
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

function getComponent(place: any, type: string, mode: "long_name" | "short_name" = "long_name") {
  const match = place?.address_components?.find((part: any) => Array.isArray(part.types) && part.types.includes(type));
  return match?.[mode] ?? "";
}

function parsePlace(place: any): AddressParts {
  const streetNumber = getComponent(place, "street_number");
  const route = getComponent(place, "route");
  const suburb =
    getComponent(place, "locality") ||
    getComponent(place, "postal_town") ||
    getComponent(place, "sublocality_level_1") ||
    getComponent(place, "administrative_area_level_2");
  const state = getComponent(place, "administrative_area_level_1", "short_name");
  const postcode = getComponent(place, "postal_code");
  const streetAddress = [streetNumber, route].filter(Boolean).join(" ").trim();

  return {
    address: streetAddress || place?.name || place?.formatted_address || "",
    suburb,
    state,
    postcode,
    formattedAddress: place?.formatted_address || "",
  };
}

export function GoogleAddressInput({
  id,
  value,
  placeholder,
  className,
  disabled,
  onChange,
  onResolved,
}: GoogleAddressInputProps) {
  const fallbackId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listenerRef = useRef<any>(null);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    let active = true;

    async function setupAutocomplete() {
      if (!inputRef.current || disabled) return;
      await ensureGoogleMaps();
      if (!active || !inputRef.current || !(window as any).google?.maps?.places) return;

      if (autocompleteRef.current) return;

      autocompleteRef.current = new (window as any).google.maps.places.Autocomplete(inputRef.current, {
        types: ["address"],
        fields: ["address_components", "formatted_address", "name"],
        componentRestrictions: { country: "au" },
      });

      listenerRef.current = autocompleteRef.current.addListener("place_changed", () => {
        const place = autocompleteRef.current?.getPlace?.();
        const parsed = parsePlace(place);
        if (parsed.address) onChange(parsed.address);
        onResolved?.(parsed);
      });
    }

    setupAutocomplete().catch(() => {
      // Fail open: normal text input remains usable.
    });

    return () => {
      active = false;
      if (listenerRef.current?.remove) listenerRef.current.remove();
      listenerRef.current = null;
      autocompleteRef.current = null;
    };
  }, [disabled, onChange, onResolved]);

  return (
    <Input
      id={id ?? fallbackId}
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
