"use client";

import { useEffect, useId, useRef } from "react";
import { Input } from "@/components/ui/input";

declare global {
  interface Window {
    google?: any;
  }
}

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

let mapsScriptPromise: Promise<void> | null = null;

function loadGoogleMapsPlaces(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.places) return Promise.resolve();

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.resolve();

  if (mapsScriptPromise) return mapsScriptPromise;

  mapsScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("google-maps-places-script") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps script")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-places-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps script"));
    document.head.appendChild(script);
  });

  return mapsScriptPromise;
}

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
      await loadGoogleMapsPlaces();
      if (!active || !inputRef.current || !window.google?.maps?.places) return;

      if (autocompleteRef.current) return;

      autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
        types: ["address"],
        fields: ["address_components", "formatted_address", "name"],
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

