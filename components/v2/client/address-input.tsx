"use client";

/**
 * Estate address autocomplete — native v2 port of the legacy shared
 * GoogleAddressInput/AddressSearchInput pair. Uses the Places (New)
 * AutocompleteSuggestion data API via the shared lib loader and renders an
 * Estate-token themed input + suggestion list. Falls back to a plain typed
 * input when Places is unavailable.
 */
import * as React from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadPlacesLibrary } from "@/lib/google-maps/client";

export type EAddressParts = {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  formattedAddress?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
};

type Suggestion = {
  id: string;
  primary: string;
  secondary: string;
  prediction: any;
};

function getComponent(place: any, type: string, mode: "longText" | "shortText" = "longText"): string {
  const match = (place?.addressComponents ?? []).find(
    (part: any) => Array.isArray(part.types) && part.types.includes(type)
  );
  return match?.[mode] ?? match?.[mode === "longText" ? "long_name" : "short_name"] ?? "";
}

function parsePlaceToParts(place: any): EAddressParts {
  const subpremise = getComponent(place, "subpremise");
  const streetNumber = getComponent(place, "street_number");
  const route = getComponent(place, "route");
  const suburb =
    getComponent(place, "locality") ||
    getComponent(place, "postal_town") ||
    getComponent(place, "sublocality_level_1") ||
    getComponent(place, "administrative_area_level_2");
  const state = getComponent(place, "administrative_area_level_1", "shortText");
  const postcode = getComponent(place, "postal_code");

  const numberPart = [subpremise, streetNumber].filter(Boolean).join("/");
  const reassembled = [numberPart, route].filter(Boolean).join(" ").trim();
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

export function EAddressInput({
  id,
  value,
  placeholder = "Start typing an address…",
  disabled,
  className,
  onChange,
  onResolved,
}: {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
  onResolved?: (parts: EAddressParts) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const placesRef = React.useRef<any>(null);
  const tokenRef = React.useRef<any>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = React.useRef(0);

  const [ready, setReady] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = React.useState(-1);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const places = await loadPlacesLibrary();
        if (!active) return;
        if (!places?.AutocompleteSuggestion) {
          setReady(false);
          return;
        }
        placesRef.current = places;
        try {
          tokenRef.current = new places.AutocompleteSessionToken();
        } catch {
          tokenRef.current = null;
        }
        setReady(true);
      } catch {
        if (active) setReady(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const runSearch = React.useCallback((text: string) => {
    const places = placesRef.current;
    if (!places?.AutocompleteSuggestion || !text.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: text,
      includedRegionCodes: ["au"],
      sessionToken: tokenRef.current ?? undefined,
    })
      .then((res: any) => {
        if (seq !== seqRef.current) return;
        const list: Suggestion[] = (res?.suggestions ?? [])
          .map((s: any) => s?.placePrediction)
          .filter(Boolean)
          .map((p: any) => ({
            id: p.placeId ?? p.place ?? p?.text?.text ?? Math.random().toString(36),
            primary: p?.mainText?.text ?? p?.text?.text ?? "",
            secondary: p?.secondaryText?.text ?? "",
            prediction: p,
          }))
          .filter((s: Suggestion) => s.primary);
        setSuggestions(list);
        setOpen(list.length > 0);
        setActiveIndex(-1);
      })
      .catch(() => {
        if (seq === seqRef.current) {
          setSuggestions([]);
          setOpen(false);
        }
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, []);

  function handleInput(text: string) {
    onChange(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!ready) return;
    debounceRef.current = setTimeout(() => runSearch(text), 250);
  }

  async function selectSuggestion(s: Suggestion) {
    setOpen(false);
    setActiveIndex(-1);
    try {
      const place = s.prediction.toPlace();
      if (typeof place.fetchFields === "function") {
        await place.fetchFields({
          fields: ["addressComponents", "formattedAddress", "location", "id", "displayName"],
        });
      }
      const parts = parsePlaceToParts(place);
      if (parts.address) onChange(parts.address);
      onResolved?.(parts);
    } catch {
      onChange(s.secondary ? `${s.primary}, ${s.secondary}` : s.primary);
    }
    const places = placesRef.current;
    if (places?.AutocompleteSessionToken) {
      try {
        tokenRef.current = new places.AutocompleteSessionToken();
      } catch {
        /* ignore */
      }
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      void selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
        <input
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 pl-9 pr-9",
            "text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))]",
            "transition-[border-color,box-shadow] duration-[160ms] focus:outline-none",
            "focus:border-[hsl(var(--e-ring))] focus:ring-2 focus:ring-[hsl(var(--e-ring)/0.25)] disabled:opacity-50"
          )}
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[hsl(var(--e-text-faint))]" />
        ) : null}
      </div>

      {open && suggestions.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] py-1 shadow-[var(--e-elevation-2)]">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  void selectSuggestion(s);
                }}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-[0.875rem]",
                  i === activeIndex
                    ? "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-foreground))]"
                    : "hover:bg-[hsl(var(--e-muted))]"
                )}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-text-faint))]" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.primary}</span>
                  {s.secondary ? (
                    <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {s.secondary}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
