"use client";

/**
 * ESTATE address autocomplete — v2-native equivalent of
 * components/ui/address-autocomplete.tsx built directly on the Google Places
 * (New) AutocompleteSuggestion data API via lib/google-maps/client. Renders an
 * Estate-token input plus a themed suggestion list; degrades to a plain typed
 * input when the Places SDK is unavailable. No components/ui or
 * components/shared dependency.
 */
import * as React from "react";
import { Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadPlacesLibrary, parseNewPlace } from "@/lib/google-maps/client";
import type { AddressResult } from "@/lib/google-maps/types";
import { E_INPUT_CLASS } from "@/components/v2/admin/estate-kit";

type Suggestion = {
  id: string;
  primary: string;
  secondary: string;
  prediction: any;
};

export function EAddressInput({
  value,
  placeholder = "Start typing an address…",
  disabled,
  className,
  onSelect,
  onChange,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSelect: (result: AddressResult) => void;
  onChange: (text: string) => void;
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

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const places = await loadPlacesLibrary();
        if (!active) return;
        if (!places?.AutocompleteSuggestion) return;
        placesRef.current = places;
        try {
          tokenRef.current = new places.AutocompleteSessionToken();
        } catch {
          tokenRef.current = null;
        }
        setReady(true);
      } catch {
        /* plain input fallback */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Close on outside click.
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const search = (text: string) => {
    if (!ready || !placesRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim() || text.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const seq = ++seqRef.current;
      try {
        const request: Record<string, unknown> = {
          input: text,
          includedRegionCodes: ["au"],
        };
        if (tokenRef.current) request.sessionToken = tokenRef.current;
        const { suggestions: raw } =
          await placesRef.current.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        if (seq !== seqRef.current) return;
        const mapped: Suggestion[] = (raw ?? [])
          .filter((s: any) => s?.placePrediction)
          .map((s: any, i: number) => ({
            id: s.placePrediction.placeId ?? String(i),
            primary: s.placePrediction.mainText?.text ?? s.placePrediction.text?.text ?? "",
            secondary: s.placePrediction.secondaryText?.text ?? "",
            prediction: s.placePrediction,
          }));
        setSuggestions(mapped);
        setOpen(mapped.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, 250);
  };

  const pick = async (suggestion: Suggestion) => {
    setOpen(false);
    setSuggestions([]);
    try {
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({
        fields: ["formattedAddress", "addressComponents", "location", "id", "displayName"],
      });
      const normalized = parseNewPlace(place);
      if (normalized) {
        onChange(normalized.formattedAddress);
        onSelect(normalized);
        // New session token per completed selection (billing best practice).
        try {
          tokenRef.current = new placesRef.current.AutocompleteSessionToken();
        } catch {
          /* keep old token */
        }
      }
    } catch {
      /* leave the typed text in place */
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={cn(E_INPUT_CLASS, className)}
        onChange={(e) => {
          onChange(e.target.value);
          search(e.target.value);
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
      />
      {loading ? (
        <Loader2 className="absolute right-2.5 top-3 h-4 w-4 animate-spin text-[hsl(var(--e-text-faint))]" />
      ) : null}
      {open && suggestions.length > 0 ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-2)]">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => void pick(s)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[hsl(var(--e-primary-soft)/0.35)]"
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-gold-ink))]" />
              <span className="min-w-0">
                <span className="block truncate text-[0.8125rem] text-[hsl(var(--e-foreground))]">{s.primary}</span>
                {s.secondary ? (
                  <span className="block truncate text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {s.secondary}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
