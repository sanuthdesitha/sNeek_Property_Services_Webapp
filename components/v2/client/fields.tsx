"use client";

/**
 * Estate form field primitives for the client portal — styled entirely with
 * `--e-*` tokens. No dependency on components/ui.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] " +
  "px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "transition-[border-color,box-shadow] duration-[160ms] focus:outline-none " +
  "focus:border-[hsl(var(--e-ring))] focus:ring-2 focus:ring-[hsl(var(--e-ring)/0.25)] disabled:opacity-50";

export function ELabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-muted-foreground))]",
        className
      )}
      {...props}
    />
  );
}

export const EInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(FIELD_BASE, "h-10", className)} {...props} />
  )
);
EInput.displayName = "EInput";

export const ETextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(FIELD_BASE, "min-h-[5rem] py-2", className)} {...props} />
));
ETextarea.displayName = "ETextarea";

export const ESelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(FIELD_BASE, "h-10 appearance-none pr-8", className)} {...props} />
  )
);
ESelect.displayName = "ESelect";

/** Hairline check tile — a labelled toggle rendered as an Estate chip. */
export function ECheckTile({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-2.5 rounded-[var(--e-radius)] border px-3 py-2.5 text-left text-[0.8125rem] transition-colors duration-[160ms]",
        checked
          ? "border-[hsl(var(--e-accent-portal))] bg-[hsl(var(--e-accent-portal-soft))] text-[hsl(var(--e-foreground))]"
          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-border-strong))]"
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border",
          checked
            ? "border-[hsl(var(--e-accent-portal))] bg-[hsl(var(--e-accent-portal))]"
            : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))]"
        )}
      >
        {checked ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" aria-hidden>
            <path
              d="M2.5 6.5L5 9l4.5-6"
              stroke="hsl(var(--e-accent-portal-foreground))"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      {children}
    </button>
  );
}

/** Inline status line for async actions (no Toaster is mounted in the v2 tree). */
export function EInlineNotice({
  tone,
  children,
  className,
}: {
  tone: "success" | "danger" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const color =
    tone === "success"
      ? "hsl(var(--e-success))"
      : tone === "danger"
        ? "hsl(var(--e-danger))"
        : "hsl(var(--e-info))";
  return (
    <p className={cn("text-[0.75rem] font-medium", className)} style={{ color }} role="status">
      {children}
    </p>
  );
}
