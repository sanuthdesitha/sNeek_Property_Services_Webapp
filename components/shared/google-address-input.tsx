"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ensureGoogleMaps } from "@/lib/maps/loader";

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
 * Public-shape Google address input.
 *
 * Migrated to use the **new** `PlaceAutocompleteElement` (Places API New).
 * When the new element is unavailable or the SDK fails, we fall back to a
 * plain typed input so users can still complete forms manually.
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
  const fallbackId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | null = null;

    async function setupAutocomplete() {
      if (!containerRef.current || disabled) return;
      try {
        await ensureGoogleMaps();
        if (!active || !containerRef.current) return;
        const g: any = (window as any).google;
        if (!g?.maps?.importLibrary) {
          throw new Error("Google Maps importLibrary unavailable");
        }
        const placesLib: any = await g.maps.importLibrary("places");
        if (!active || !containerRef.current) return;
        const ElementCtor = placesLib?.PlaceAutocompleteElement;
        if (!ElementCtor) {
          throw new Error("PlaceAutocompleteElement unavailable");
        }

        let el: any;
        try {
          el = new ElementCtor({
            componentRestrictions: { country: ["au"] },
            types: ["address"],
          });
        } catch {
          el = new ElementCtor();
          try {
            el.componentRestrictions = { country: ["au"] };
          } catch {
            /* ignore */
          }
          try {
            el.types = ["address"];
          } catch {
            /* ignore */
          }
        }
        el.id = id ?? fallbackId;
        if (placeholder) {
          try {
            el.setAttribute("placeholder", placeholder);
          } catch {
            /* ignore */
          }
        }
        if (disabled) {
          try {
            el.setAttribute("disabled", "");
          } catch {
            /* ignore */
          }
        }

        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(el);

        const onPlaceSelect = async (event: any) => {
          try {
            const placeLike = event?.place ?? event?.placePrediction?.toPlace?.();
            if (!placeLike) return;
            if (typeof placeLike.fetchFields === "function") {
              await placeLike.fetchFields({
                fields: [
                  "addressComponents",
                  "formattedAddress",
                  "location",
                  "id",
                  "displayName",
                ],
              });
            }
            const parsed = parseNewPlaceToParts(placeLike);
            if (parsed.address) onChange(parsed.address);
            onResolved?.(parsed);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[GoogleAddressInput] place fetch failed", err);
          }
        };
        el.addEventListener("gmp-placeselect", onPlaceSelect);
        el.addEventListener("gmp-select", onPlaceSelect);

        cleanup = () => {
          el.removeEventListener("gmp-placeselect", onPlaceSelect);
          el.removeEventListener("gmp-select", onPlaceSelect);
          try {
            el.remove();
          } catch {
            /* ignore */
          }
        };
        if (active) setMode("ready");
      } catch {
        // Fail open: fall back to plain input
        if (active) setMode("fallback");
      }
    }

    setupAutocomplete();

    return () => {
      active = false;
      if (cleanup) cleanup();
    };
  }, [disabled, onChange, onResolved, id, fallbackId, placeholder]);

  if (mode === "fallback") {
    return (
      <Input
        id={id ?? fallbackId}
        ref={fallbackInputRef}
        value={value}
        placeholder={placeholder}
        className={className}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={className ?? "address-autocomplete-wrapper"}
      style={{ display: "block", width: "100%" }}
    />
  );
}
