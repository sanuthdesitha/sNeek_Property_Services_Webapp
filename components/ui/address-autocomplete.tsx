"use client";

import * as React from "react";
import { AddressSearchInput } from "@/components/shared/address-search-input";
import { parseNewPlace } from "@/lib/google-maps/client";
import type { AddressResult } from "@/lib/google-maps/types";

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
 * Themed address autocomplete. Thin adapter over {@link AddressSearchInput}
 * (AutocompleteSuggestion data API) so the dropdown matches our design tokens
 * and the field stays editable/re-searchable — replacing the old
 * `PlaceAutocompleteElement` web component and its off-theme shadow dropdown.
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
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? value ?? "");

  // Sync controlled value when provided.
  React.useEffect(() => {
    if (value !== undefined) setInternalValue(value);
  }, [value]);

  return (
    <AddressSearchInput
      id={id}
      value={internalValue}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      onChange={(text) => {
        setInternalValue(text);
        onChange?.(text);
      }}
      onPlaceSelected={(place) => {
        const normalized = parseNewPlace(place);
        if (normalized) {
          setInternalValue(normalized.formattedAddress);
          onSelect(normalized);
        }
      }}
    />
  );
}
