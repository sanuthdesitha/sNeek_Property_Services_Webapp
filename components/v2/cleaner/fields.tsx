"use client";

/**
 * Estate form primitives for v2 worker portals. Styled exclusively through the
 * Estate token scope (`--e-*`) — zero dependency on the live `components/ui/*`.
 * Shared by the cleaner / laundry / QA v2 components.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export const E_FIELD_CLASS =
  "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 " +
  "text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "transition-[border-color,box-shadow] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] " +
  "focus-visible:outline-none focus-visible:border-[hsl(var(--e-ring))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--e-ring))] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const EInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(E_FIELD_CLASS, className)} {...props} />
  )
);
EInput.displayName = "EInput";

export const ETextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(E_FIELD_CLASS, "h-auto min-h-[80px] py-2 leading-relaxed", className)}
    {...props}
  />
));
ETextarea.displayName = "ETextarea";

export const ESelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(E_FIELD_CLASS, "appearance-auto pr-8", className)} {...props}>
      {children}
    </select>
  )
);
ESelect.displayName = "ESelect";

export function ELabel({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-[0.6875rem] font-[550] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]",
        className
      )}
      {...props}
    />
  );
}

export function EField({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <ELabel>{label}</ELabel>
      {children}
      {hint ? <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{hint}</p> : null}
    </div>
  );
}

/** Estate checkbox — native input tinted with the portal accent. */
export function ECheckbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn("h-4 w-4 cursor-pointer rounded-[var(--e-radius-xs)]", className)}
      style={{ accentColor: "hsl(var(--e-primary))" }}
      {...props}
    />
  );
}

/** Estate switch — pill toggle with sliding knob. */
export function ESwitch({
  checked,
  onCheckedChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-[var(--e-radius-pill)] border transition-colors duration-[160ms]",
        checked
          ? "border-transparent bg-[hsl(var(--e-primary))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))]",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
    >
      <span
        className={cn(
          "inline-block h-4.5 w-4.5 translate-x-1 rounded-full bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-1)] transition-transform duration-[160ms]",
          checked ? "translate-x-[1.375rem]" : "translate-x-[0.1875rem]"
        )}
        style={{ height: "1.125rem", width: "1.125rem" }}
      />
    </button>
  );
}

/** Filter chip row used by list screens. */
export function EChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-[550] tracking-[0.02em] transition-colors duration-[160ms]",
        active
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      )}
    >
      {children}
    </button>
  );
}

/** Hidden-input file picker styled as an Estate outline button. */
export function EFileButton({
  onFiles,
  accept = "image/*",
  multiple = false,
  disabled = false,
  children,
  className,
}: {
  onFiles: (files: FileList | null) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted))]",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {children}
    </label>
  );
}
