"use client";

import * as React from "react";
import { loadPlacesLibrary, parseNewPlace } from "@/lib/google-maps/client";
import type { AddressResult } from "@/lib/google-maps/types";
import { cn } from "@/lib/utils";

export interface AddressAutocompleteProps {
  id?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelect: (result: AddressResult) => void;
  onChange?: (text: string) => void;
}

/**
 * Uses the **new** Places API web component `PlaceAutocompleteElement`
 * (under "Places API (New)" in GCP). The component renders its own input
 * + suggestion list; we style it via shadow ::part(...) selectors in
 * `app/globals.css`.
 *
 * Falls back to a plain `<input>` when the SDK fails to load (bad key,
 * referrer restriction, Places API New not enabled, offline, etc.).
 */
export function AddressAutocomplete({
  id,
  value,
  defaultValue,
  placeholder = "Start typing an address…",
  disabled,
  className,
  onSelect,
  onChange,
}: AddressAutocompleteProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const fallbackRef = React.useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? value ?? "");
  const [mode, setMode] = React.useState<"loading" | "ready" | "fallback">("loading");

  // Sync controlled value (only relevant for the fallback input)
  React.useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  React.useEffect(() => {
    if (!containerRef.current) return;
    let cleanup: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        const placesLib: any = await loadPlacesLibrary();
        if (cancelled || !containerRef.current) return;

        const ElementCtor = placesLib.PlaceAutocompleteElement;
        if (!ElementCtor) {
          throw new Error(
            "PlaceAutocompleteElement not available on the loaded Places library. " +
              "Ensure 'Places API (New)' is enabled in Google Cloud Console."
          );
        }

        // Try the documented constructor signature first; fall back to
        // setAttribute / property assignment if the constructor rejects opts.
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

        el.id = id ?? "place-autocomplete-element";
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
            // Per docs the event carries a `place` property (placePrediction
            // in older betas — handle both).
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
            const normalized = parseNewPlace(placeLike);
            if (normalized) {
              setInternalValue(normalized.formattedAddress);
              onSelect(normalized);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[AddressAutocomplete] place fetch failed", err);
          }
        };
        // The event name has shipped under a couple of variants over the
        // beta period — register both to be safe.
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
        setMode("ready");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load Maps SDK";
        setLoadError(message);
        setMode("fallback");
      }
    })();

    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("space-y-1", className)}>
      {mode !== "fallback" ? (
        <div
          ref={containerRef}
          className="address-autocomplete-wrapper"
          style={{ display: "block", width: "100%" }}
        >
          {/* PlaceAutocompleteElement is inserted here at runtime */}
        </div>
      ) : (
        <input
          ref={fallbackRef}
          id={id}
          value={internalValue}
          onChange={(e) => {
            setInternalValue(e.target.value);
            onChange?.(e.target.value);
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="flex h-10 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      )}
      {loadError && (
        <div className="space-y-0.5">
          <p className="text-xs text-warning">
            Address lookup unavailable — type the address manually.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Reason: <span className="font-mono">{loadError}</span>
          </p>
        </div>
      )}
    </div>
  );
}
