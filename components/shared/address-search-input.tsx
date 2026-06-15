"use client";

import * as React from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadPlacesLibrary } from "@/lib/google-maps/client";

export interface AddressSearchInputProps {
  id?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Controlled text changes (typing or after a selection writes the address). */
  onChange: (value: string) => void;
  /**
   * Fired with the resolved Google Place (after fetchFields) when a suggestion
   * is picked. The caller maps it to whatever shape it needs.
   */
  onPlaceSelected: (place: any) => void;
}

type Suggestion = {
  id: string;
  primary: string;
  secondary: string;
  prediction: any;
};

/**
 * Themed Google Places autocomplete built on the **AutocompleteSuggestion**
 * data API (Places API New) — NOT the `PlaceAutocompleteElement` web component.
 *
 * Why: the web component renders its own shadow-DOM dropdown that ignores our
 * design tokens (the "weird black background") and turns into a read-only-feeling
 * address box once a place is picked. This renders a normal themed `<input>` plus
 * our own suggestion list, so it matches the app theme everywhere, stays fully
 * editable, and can be re-searched at any time. Falls back to a plain typed
 * input when the SDK / Places (New) is unavailable.
 */
export function AddressSearchInput({
  id,
  value,
  placeholder = "Search for an address…",
  disabled,
  className,
  onChange,
  onPlaceSelected,
}: AddressSearchInputProps) {
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

  // Load Places once.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const places = await loadPlacesLibrary();
        if (!active) return;
        if (!places?.AutocompleteSuggestion) {
          // No new-API autocomplete — degrade to a plain typed input.
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

  // Close on outside click.
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
        if (seq !== seqRef.current) return; // stale
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
      onPlaceSelected(place);
    } catch {
      // If detail fetch fails, at least keep the typed text.
      onChange(s.secondary ? `${s.primary}, ${s.secondary}` : s.primary);
    }
    // Start a fresh billing session for the next search.
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
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
          className="flex h-10 w-full rounded-md border border-border-strong bg-surface px-3 py-2 pl-9 pr-9 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {open && suggestions.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
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
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                  i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.primary}</span>
                  {s.secondary ? (
                    <span className="block truncate text-xs text-muted-foreground">{s.secondary}</span>
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
