"use client";

import { cn } from "@/lib/utils";
import { forwardRef, SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, helperText, options, placeholder, id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-sm font-medium text-text-primary mb-1.5"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            "w-full h-10 px-3 text-sm rounded-lg border transition-colors duration-200",
            "bg-transparent text-text-primary",
            "focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1",
            "disabled:pointer-events-none disabled:opacity-50",
            error
              ? "border-danger-500 focus:ring-danger-500"
              : "border-neutral-300 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-600",
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && (
          <p className="mt-1.5 text-sm text-danger-600">{error}</p>
        )}
        {helperText && !error && (
          <p className="mt-1.5 text-sm text-text-tertiary">{helperText}</p>
        )}
      </div>
    );
  },
);

Select.displayName = "Select";

export { Select };
