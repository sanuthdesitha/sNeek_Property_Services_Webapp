"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface MultiSelectDropdownProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyText?: string;
}

export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = "Select items",
  emptyText = "No options found.",
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);

  const selectedLabels = useMemo(
    () =>
      options
        .filter((option) => selected.includes(option.id))
        .map((option) => option.label),
    [options, selected]
  );

  function toggleValue(id: string, checked: boolean) {
    onChange(
      checked ? [...selected, id] : selected.filter((value) => value !== id)
    );
  }

  return (
    <div className={cn("relative", open && "z-50")}>
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between rounded-xl border border-input/80 bg-white/80 px-3 text-left text-sm"
        onClick={() => setOpen((value) => !value)}
      >
        <span className={cn("truncate", selectedLabels.length === 0 ? "text-muted-foreground" : "text-foreground")}>
          {selectedLabels.length > 0
            ? `${selectedLabels.slice(0, 2).join(", ")}${selectedLabels.length > 2 ? ` +${selectedLabels.length - 2}` : ""}`
            : placeholder}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-[60] mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-border/70 bg-white p-2 shadow-xl">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <div className="space-y-1">
              {options.map((option) => (
                <label
                  key={option.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl px-2 py-2 text-sm hover:bg-muted/50",
                    option.disabled && "cursor-not-allowed opacity-60"
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(option.id)}
                    disabled={option.disabled}
                    onChange={(event) => toggleValue(option.id, event.target.checked)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="block text-xs text-muted-foreground">{option.hint}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-2 flex justify-end border-t border-border/60 pt-2">
            <button
              type="button"
              className="rounded-full px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
