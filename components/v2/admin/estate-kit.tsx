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
import { PHONE_SHEET_CONTAINER_CLASS, PHONE_SHEET_GRAB_CLASS, PHONE_SHEET_PANEL_CLASS } from "@/components/v2/ui/phone";
import { markFieldControl, useAssociatedField } from "./field-association";
import {
  EConfirmDialog,
  type ConfirmDetailsConfig,
  type ConfirmReasonConfig,
  type ConfirmTier,
} from "@/components/v2/ui/confirm-dialog";
import { sensitiveVerificationText, type SensitiveCredentialsInput } from "@/lib/security/pin-rules";

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
markFieldControl(EInput);

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
markFieldControl(ETextarea);
markFieldControl(ESelect);

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
  // A single control child gets an id so the label (and hint) describe it.
  const field = useAssociatedField(children, { hasHint: Boolean(hint) });
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={field.controlId} className={E_LABEL_CLASS}>{label}</label>
      {field.control}
      {hint ? (
        <p id={field.hintId} className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{hint}</p>
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
function revealActiveChip(element: HTMLAnchorElement | null) {
  element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

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
            // On a phone the row scrolls sideways; keep the current tab in view.
            ref={tab.active ? revealActiveChip : undefined}
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
const MODAL_SIZE = {
  md: "max-w-md",
  wide: "max-w-2xl",
  xl: "max-w-4xl",
  full: "max-w-6xl",
} as const;

export function EModal({
  open,
  onClose,
  title,
  eyebrow,
  wide = false,
  size,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  wide?: boolean;
  size?: keyof typeof MODAL_SIZE;
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
      // A bottom sheet below 640px (board "Admin phone"); unchanged from 640px up.
      className={cn("fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center", PHONE_SHEET_CONTAINER_CLASS)}
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
          MODAL_SIZE[size ?? (wide ? "wide" : "md")],
          PHONE_SHEET_PANEL_CLASS,
        )}
      >
        <span aria-hidden className={PHONE_SHEET_GRAB_CLASS} />
        <div className="flex items-start justify-between gap-4 border-b border-[hsl(var(--e-border))] px-6 py-4">
          <div className="min-w-0">
            {eyebrow ? <EEyebrow className="mb-1">{eyebrow}</EEyebrow> : null}
            <h2 className="e-display-sm break-words">{title}</h2>
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
        <div className="max-h-[82vh] overflow-y-auto px-6 py-5 max-sm:max-h-none max-sm:overflow-visible max-sm:px-4">{children}</div>
      </ECard>
    </div>
  );
}

/* ── Confirm modal: the three confirmation tiers ───────────────────────── */
/**
 * Kept for every existing call site; renders the shared EConfirmDialog
 * (components/v2/ui/confirm-dialog.tsx, board "Confirmations and deletes").
 * The tier follows the old options unless `tier` is given:
 *   requireSecurity → sensitive (C), danger (the default) → destructive (B),
 *   danger={false} → ordinary (A).
 * `confirmPhrase` is accepted and ignored: nobody types DELETE, VOID, REMOVE
 * or DISCARD any more (2026-11-14). `onConfirm` receives the credentials
 * (sensitive tier) and the composed reason (when `reason` is configured).
 */
export function EConfirmModal({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  requireSecurity = false,
  danger = true,
  tier,
  reason,
  details,
  error,
  confirmDisabled,
  loading = false,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  /** @deprecated Ignored since 2026-11-14 (no typed confirmation words). */
  confirmPhrase?: string;
  /** When true the person's OWN PIN is required (or, with none yet, their password) and passed to onConfirm. */
  requireSecurity?: boolean;
  danger?: boolean;
  tier?: ConfirmTier;
  reason?: ConfirmReasonConfig;
  details?: ConfirmDetailsConfig;
  error?: React.ReactNode;
  confirmDisabled?: boolean;
  loading?: boolean;
  onConfirm: (credentials?: SensitiveCredentialsInput, reason?: string) => void | Promise<unknown>;
}) {
  const resolvedTier: ConfirmTier = tier ?? (requireSecurity ? "sensitive" : danger ? "destructive" : "ordinary");
  return (
    <EConfirmDialog
      open={open}
      onClose={onClose}
      tier={resolvedTier}
      title={title}
      description={description}
      reason={reason}
      details={details}
      error={error}
      confirmDisabled={confirmDisabled}
      confirmLabel={confirmLabel}
      busy={loading}
      onConfirm={(result) => onConfirm(result.credentials, result.reason)}
    >
      {children}
    </EConfirmDialog>
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
/** Phone-only stacking: each row becomes a wrapped card (first cell full width, the rest flow beside each other). */
const TABLE_PHONE_STACK_CLASS =
  "max-sm:block max-sm:min-w-0 max-sm:[&_tbody]:block max-sm:[&_tr]:flex max-sm:[&_tr]:flex-wrap max-sm:[&_tr]:items-center max-sm:[&_tr]:gap-x-1 max-sm:[&_tr]:py-2 max-sm:[&_td]:py-1 max-sm:[&_td:first-child]:basis-full";

export function ETableShell({
  headers,
  className,
  phoneStack = false,
  children,
}: {
  headers: Array<{ label: React.ReactNode; align?: "left" | "right" | "center"; className?: string }>;
  className?: string;
  /** Below 640px stack rows instead of scrolling sideways (headers are hidden; cells must label themselves). */
  phoneStack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      {/* min-w makes the overflow wrapper real: w-full alone just crushed
          five columns into a 295px card and the scrollbar never appeared. */}
      <table className={cn("w-full min-w-[46rem] text-[0.875rem]", phoneStack && TABLE_PHONE_STACK_CLASS)}>
        <thead className={phoneStack ? "max-sm:hidden" : undefined}>
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

/**
 * A delete button that asks once, on itself.
 *
 * The LOW tier of the three confirmation levels. The first click arms it and
 * the label changes to ask; a second click within a few seconds does the thing.
 * No modal, because a dialog for removing one row from a list is friction that
 * teaches people to dismiss dialogs without reading — which is precisely what
 * makes the modal tier (EConfirmModal) stop working when it matters.
 *
 * It disarms itself on a timer and when the pointer leaves. An armed button
 * left sitting on screen is a trap for the next person who clicks where the
 * harmless button used to be.
 *
 * Use EConfirmModal (tier B, destructive) instead when the thing being
 * deleted is not trivially recreatable, and EConfirmModal with requireSecurity
 * (tier C, sensitive) for anything destroying records that other work depends on.
 */
export function EConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Sure?",
  disabled = false,
  className,
  ariaLabel,
  armedMs = 4000,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  confirmLabel?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  armedMs?: number;
}) {
  const [armed, setArmed] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  }, []);

  React.useEffect(() => disarm, [disarm]);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onMouseLeave={armed ? disarm : undefined}
      onBlur={armed ? disarm : undefined}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), armedMs);
          return;
        }
        disarm();
        onConfirm();
      }}
      className={
        className ??
        (armed
          ? "inline-flex h-8 items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.12)] px-2 text-[0.75rem] font-[600] text-[hsl(var(--e-danger))]"
          : "inline-flex h-8 items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
      }
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

/**
 * Verify-only pre-check of the PIN/password an EConfirmModal collected.
 *
 * Prefer sending `security` to the action's own route, which verifies it with
 * verifySensitiveAction in the same request (2026-11-14: every tier C route in
 * the board's inventory does). This pre-check remains for the few settings
 * screens owned by other work that still call it; it is not a substitute for a
 * server check on the action itself.
 *
 * Throws on failure so the caller can abort before deleting anything.
 */
export async function verifyAdminSecurity(credentials?: SensitiveCredentialsInput) {
  const res = await fetch("/api/admin/security/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: credentials?.pin, password: credentials?.password, newPin: credentials?.newPin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ? sensitiveVerificationText(body.error) : "Could not verify your PIN.");
  }
}
