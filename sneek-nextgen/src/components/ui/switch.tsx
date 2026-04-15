"use client";

import { cn } from "@/lib/utils";
import { forwardRef, InputHTMLAttributes, useId } from "react";

export interface SwitchProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
}

const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, description, id, ...props }, ref) => {
    const switchId = id || useId();

    return (
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1">
          {label && (
            <label htmlFor={switchId} className="text-sm font-medium text-text-primary cursor-pointer">
              {label}
            </label>
          )}
          {description && (
            <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
          )}
        </div>
        <input
          ref={ref}
          id={switchId}
          type="checkbox"
          role="switch"
          className={cn(
            "peer h-5 w-9 shrink-0 rounded-full border-2 border-transparent",
            "bg-neutral-300 dark:bg-neutral-700",
            "checked:bg-brand-600 dark:checked:bg-brand-500",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors duration-200",
            "cursor-pointer",
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);

Switch.displayName = "Switch";

export { Switch };
