"use client";

/**
 * Estate form controls — hairline inputs, eyebrow labels, discreet status
 * lines. Styled entirely with `--e-*` tokens; no dependency on the live
 * `components/ui/*` kit. Shared by the v2 Settings and Finance workspaces.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] " +
  "px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "transition-colors duration-[160ms] focus:outline-none focus:border-[hsl(var(--e-ring))] " +
  "focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:cursor-not-allowed disabled:opacity-60";

export const EInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(FIELD_BASE, "h-10", className)} {...props} />
  )
);
EInput.displayName = "EInput";

export const ETextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(FIELD_BASE, "min-h-[90px] py-2", className)} {...props} />
  )
);
ETextarea.displayName = "ETextarea";

export function ESelectNative({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD_BASE, "h-10 appearance-none pr-8", className)} {...props}>
      {children}
    </select>
  );
}

/** Label + control + optional hint, Estate style. */
export function EField({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-secondary))]"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="text-[0.75rem] leading-relaxed text-[hsl(var(--e-text-faint))]">{hint}</p> : null}
    </div>
  );
}

/** Hairline toggle switch on Estate tokens. */
export function EToggle({
  checked,
  onChange,
  disabled,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors duration-[160ms]",
        checked
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))]",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        !label && className
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-[hsl(var(--e-surface))] shadow-sm transition-transform duration-[160ms]",
          checked ? "translate-x-[1.375rem]" : "translate-x-1"
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-[0.875rem] font-medium">{label}</p>
        {description ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
}

/** Inline save-status line: "Saved" fades in gold, errors in danger. */
export function ESaveStatus({ status }: { status: { kind: "idle" | "saved" | "error"; message?: string } }) {
  if (status.kind === "idle") return null;
  return (
    <span
      className={cn(
        "text-[0.8125rem] font-medium",
        status.kind === "saved" ? "text-[hsl(var(--e-gold-ink))]" : "text-[hsl(var(--e-danger))]"
      )}
    >
      {status.kind === "saved" ? (status.message ?? "Saved") : (status.message ?? "Something went wrong")}
    </span>
  );
}

export function useSaveStatus() {
  const [status, setStatus] = React.useState<{ kind: "idle" | "saved" | "error"; message?: string }>({
    kind: "idle",
  });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = React.useCallback((kind: "saved" | "error", message?: string) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus({ kind, message });
    timer.current = setTimeout(() => setStatus({ kind: "idle" }), kind === "saved" ? 3000 : 6000);
  }, []);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { status, flash };
}

/** Minimal Estate modal — hairline card over a warm scrim. */
export function EModal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[hsl(160_18%_12%/0.45)] p-4 pt-[8vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={cn(
          "e-rise w-full rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]",
          wide ? "max-w-3xl" : "max-w-lg"
        )}
      >
        <div className="border-b border-[hsl(var(--e-border))] px-6 py-5">
          {eyebrow ? <p className="e-eyebrow mb-1">{eyebrow}</p> : null}
          <h3 className="e-display-sm">{title}</h3>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/** Section header inside a settings pane: eyebrow + serif title + hairline. */
export function ESectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="e-eyebrow mb-1">{eyebrow}</p>
          <h2 className="e-display-sm">{title}</h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <hr className="e-thread" />
    </div>
  );
}
