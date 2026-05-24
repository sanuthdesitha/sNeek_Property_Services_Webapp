"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { loadPlacesLibrary, parsePlaceResult } from "@/lib/google-maps/client";
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
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? value ?? "");

  // Sync controlled value
  React.useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  React.useEffect(() => {
    if (!inputRef.current) return;
    let autocomplete: any = null;
    let listener: any = null;

    (async () => {
      try {
        const places = await loadPlacesLibrary();
        if (!inputRef.current) return;
        autocomplete = new (places as any).Autocomplete(inputRef.current, {
          componentRestrictions: { country: "au" },
          fields: ["place_id", "formatted_address", "geometry", "address_components"],
          types: ["address"],
        });
        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete!.getPlace();
          const result = parsePlaceResult(place);
          if (result) {
            setInternalValue(result.formattedAddress);
            onSelect(result);
          }
        });
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load Maps SDK");
      }
    })();

    return () => {
      if (listener) listener.remove();
      // No autocomplete.unbindAll — Google handles teardown when the input is removed
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn("space-y-1", className)}>
      <Input
        ref={inputRef}
        id={id}
        value={internalValue}
        onChange={(e) => {
          setInternalValue(e.target.value);
          onChange?.(e.target.value);
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />
      {loadError && (
        <p className="text-xs text-warning">
          Address lookup unavailable — type the address manually.
        </p>
      )}
    </div>
  );
}
