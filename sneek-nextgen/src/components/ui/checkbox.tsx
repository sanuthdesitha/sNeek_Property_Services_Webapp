"use client";

import { cn } from "@/lib/utils";
import { forwardRef, InputHTMLAttributes } from "react";

export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, description, id, ...props }, ref) => {
    const checkboxId = id || label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="flex items-start gap-3">
        <input
          ref={ref}
          id={checkboxId}
          type="checkbox"
          className={cn(
            "h-4 w-4 mt-0.5 rounded border-neutral-300 dark:border-neutral-700",
            "text-brand-600 focus:ring-brand-500 focus:ring-offset-0",
            "disabled:pointer-events-none disabled:opacity-50",
            "cursor-pointer",
            className,
          )}
          {...props}
        />
        {label && (
          <div>
            <label htmlFor={checkboxId} className="text-sm font-medium text-text-primary cursor-pointer">
              {label}
            </label>
            {description && (
              <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
            )}
          </div>
        )}
      </div>
    );
  },
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
