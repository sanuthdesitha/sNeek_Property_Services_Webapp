"use client";

/**
 * ESTATE admin form kit — small client-side building blocks shared by the v2
 * admin workspaces (cleaners / accounts / properties / inventory). Everything
 * is styled purely through the Estate token scope (`--e-*`), matching
 * components/v2/ui/primitives.tsx. No dependency on components/ui/*.
 */
import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";

/* ── Field styling (mirrors app/v2/login/page.tsx conventions) ─────────── */
export const E_INPUT_CLASS =
  "h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] " +
  "px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] " +
  "transition-[border-color,box-shadow] duration-[160ms] " +
  "focus:outline-none focus:border-[hsl(var(--e-gold))] focus:ring-1 focus:ring-[hsl(var(--e-ring))] " +
  "disabled:opacity-50";

export const E_LABEL_CLASS =
  "text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]";

export const EInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(E_INPUT_CLASS, className)} {...props} />
));
EInput.displayName = "EInput";

export function ETextarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(E_INPUT_CLASS, "h-auto min-h-[4.5rem] py-2", className)}
      {...props}
    />
  );
}

export function ESelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(E_INPUT_CLASS, "pr-8", className)} {...props}>
      {children}
    </select>
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
      <label className={E_LABEL_CLASS}>{label}</label>
      {children}
      {hint ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{hint}</p>
      ) : null}
    </div>
  );
}

/* ── Toggle switch (Estate hairline pill) ──────────────────────────────── */
export function ESwitch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex items-center gap-2 disabled:opacity-50",
        label ? "" : ""
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--e-radius-pill)] border transition-colors duration-[160ms]",
          checked
            ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))]"
            : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))]"
        )}
      >
        <span
          className={cn(
            "absolute h-3.5 w-3.5 rounded-full transition-[left] duration-[160ms]",
            checked ? "left-[18px] bg-[hsl(var(--e-primary-foreground))]" : "left-[3px] bg-[hsl(var(--e-muted-foreground))]"
          )}
        />
      </span>
      {label ? (
        <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{label}</span>
      ) : null}
    </button>
  );
}

/* ── Avatar (initials in an Estate hairline circle) ────────────────────── */
export function EAvatar({
  name,
  image,
  size = "md",
  className,
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeCls = size === "sm" ? "h-8 w-8 text-[0.6875rem]" : size === "lg" ? "h-12 w-12 text-[0.9375rem]" : "h-10 w-10 text-[0.8125rem]";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] font-[550] tracking-[0.04em] text-[hsl(var(--e-gold-ink))]",
        sizeCls,
        className
      )}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}

/* ── Chip tab bar (link-driven, keeps the Estate shell via /v2 hrefs) ──── */
export function EChipTabs({
  tabs,
  className,
}: {
  tabs: Array<{ key: string; label: React.ReactNode; href: string; active: boolean; icon?: React.ReactNode; count?: number }>;
  className?: string;
}) {
  return (
    <div className={cn("-mx-1 overflow-x-auto px-1 pb-1", className)}>
      <div className="inline-flex min-w-full items-center gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            scroll={false}
            aria-current={tab.active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[var(--e-radius)] px-3 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms]",
              tab.active
                ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]"
            )}
          >
            {tab.icon}
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "e-tnum rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem]",
                  tab.active
                    ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                    : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ── Modal (Estate ceremony card over a warm scrim) ────────────────────── */
export function EModal({
  open,
  onClose,
  title,
  eyebrow,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]"
        onClick={onClose}
      />
      <ECard
        variant="ceremony"
        className={cn(
          "e-rise relative z-10 my-8 w-full bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--e-border))] px-6 py-4">
          <div className="min-w-0">
            {eyebrow ? <EEyebrow className="mb-1">{eyebrow}</EEyebrow> : null}
            <h2 className="e-display-sm truncate">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
      </ECard>
    </div>
  );
}

/* ── Confirm modal (optional confirm phrase + security credentials) ────── */
export function EConfirmModal({
  open,
  onClose,
  title,
  description,
  confirmLabel = "Confirm",
  confirmPhrase,
  requireSecurity = false,
  danger = true,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  /** When set the user must type this phrase (e.g. "DELETE") to proceed. */
  confirmPhrase?: string;
  /** When true a PIN or password is required and passed to onConfirm. */
  requireSecurity?: boolean;
  danger?: boolean;
  loading?: boolean;
  onConfirm: (credentials?: { pin?: string; password?: string }) => void | Promise<void>;
}) {
  const [typed, setTyped] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setPin("");
      setPassword("");
    }
  }, [open]);

  const phraseOk = !confirmPhrase || typed.trim() === confirmPhrase;
  const securityOk = !requireSecurity || Boolean(pin.trim() || password.trim());
  const canConfirm = phraseOk && securityOk && !loading;

  return (
    <EModal open={open} onClose={onClose} title={title} eyebrow="Please confirm">
      <div className="space-y-4">
        {description ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{description}</p>
        ) : null}

        {confirmPhrase ? (
          <EField label={<>Type <span className="font-semibold text-[hsl(var(--e-danger))]">{confirmPhrase}</span> to continue</>}>
            <EInput
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPhrase}
              autoComplete="off"
            />
          </EField>
        ) : null}

        {requireSecurity ? (
          <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Verify with your security PIN or account password.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <EField label="Security PIN">
                <EInput
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  autoComplete="off"
                />
              </EField>
              <EField label="Or password">
                <EInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </EField>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="outline" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </EButton>
          <EButton
            variant={danger ? "danger" : "primary"}
            size="sm"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm(
                requireSecurity
                  ? { pin: pin.trim() || undefined, password: password.trim() || undefined }
                  : undefined
              )
            }
          >
            {loading ? "Working…" : confirmLabel}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

/* ── KPI link tile (Estate stat card that navigates) ───────────────────── */
export function EKpiLink({
  label,
  value,
  icon,
  href,
  tone = "neutral",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  href?: string;
  tone?: "neutral" | "warning" | "info" | "gold";
}) {
  const toneColor =
    tone === "warning"
      ? "hsl(var(--e-warning))"
      : tone === "info"
        ? "hsl(var(--e-info))"
        : tone === "gold"
          ? "hsl(var(--e-gold-ink))"
          : "hsl(var(--e-foreground))";
  const body = (
    <ECard className="h-full p-4 transition-[border-color,box-shadow] duration-[160ms] hover:border-[hsl(var(--e-border-gold)/0.5)] hover:shadow-[var(--e-elevation-1)]">
      <div className="flex items-start justify-between gap-2">
        <EEyebrow className="text-[0.625rem]">{label}</EEyebrow>
        {icon ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))] [&>svg]:h-3.5 [&>svg]:w-3.5">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="e-numeral mt-1.5 text-[1.5rem] leading-none" style={{ color: toneColor }}>
        {value}
      </p>
    </ECard>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ── Table shell (hairline, warm header) ───────────────────────────────── */
export function ETableShell({
  headers,
  className,
  children,
}: {
  headers: Array<{ label: React.ReactNode; align?: "left" | "right" | "center"; className?: string }>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-[0.875rem]">
        <thead>
          <tr className="border-b border-[hsl(var(--e-border))]">
            {headers.map((h, i) => (
              <th
                key={i}
                className={cn(
                  "px-4 py-3 text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-gold-ink))]",
                  h.align === "right" ? "text-right" : h.align === "center" ? "text-center" : "text-left",
                  h.className
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[hsl(var(--e-border))]">{children}</tbody>
      </table>
    </div>
  );
}

/* ── Discreet "classic" escape hatch for deep edge flows ───────────────── */
export function EClassicLink({ href, children }: { href: string; children?: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-[0.75rem] text-[hsl(var(--e-text-faint))] underline decoration-[hsl(var(--e-border-strong))] underline-offset-4 transition-colors hover:text-[hsl(var(--e-gold-ink))]"
    >
      {children ?? "Open classic view"}
    </Link>
  );
}
