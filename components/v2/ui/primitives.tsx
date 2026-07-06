/**
 * ESTATE v2 UI kit — core primitives, styled entirely through the Estate token
 * scope (`[data-skin="estate"]` → `--e-*` vars). No dependency on the live
 * `components/ui/*`. Hairline borders, warm surfaces, serif numerals, champagne
 * accents. Per docs/rebrand/02-design-system-estate.md §3.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/* ── Skin root ─────────────────────────────────────────────────────────── */
export function EstateSkin({
  accent = "admin",
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  accent?: "admin" | "client" | "cleaner" | "laundry" | "qa" | "maintenance" | "public";
}) {
  return (
    <div data-skin="estate" data-portal-accent={accent} className={cn("min-h-full", className)} {...rest}>
      {children}
    </div>
  );
}

/* ── Button ────────────────────────────────────────────────────────────── */
type ButtonVariant = "primary" | "gold" | "outline" | "outline-gold" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-[550] tracking-[0.01em] " +
  "transition-[background-color,box-shadow,transform,border-color] duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 " +
  "active:scale-[0.98]";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))] shadow-[var(--e-elevation-1)] hover:bg-[hsl(var(--e-primary-hover))]",
  gold:
    "bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))] shadow-[var(--e-elevation-gold)] hover:brightness-[0.97]",
  outline:
    "border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]",
  "outline-gold":
    "border border-[hsl(var(--e-gold))] bg-transparent text-[hsl(var(--e-gold-ink))] hover:bg-[hsl(var(--e-gold-soft))]",
  ghost:
    "bg-transparent text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]",
  danger:
    "bg-[hsl(var(--e-danger))] text-[hsl(var(--e-danger-foreground))] shadow-[var(--e-elevation-1)] hover:brightness-[1.05]",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 rounded-[var(--e-radius-sm)] px-3 text-[0.8125rem]",
  md: "h-10 rounded-[var(--e-radius)] px-4 text-[0.875rem]",
  lg: "h-12 rounded-[var(--e-radius)] px-6 text-[0.9375rem]",
  icon: "h-10 w-10 rounded-[var(--e-radius)]",
};

export const EButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; asChild?: boolean }
>(({ className, variant = "primary", size = "md", style, asChild = false, children, ...props }, ref) => {
  const classes = cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className);
  const mergedStyle = {
    ["--tw-ring-color" as any]: "hsl(var(--e-ring))",
    ["--tw-ring-offset-color" as any]: "hsl(var(--e-background))",
    ...style,
  };
  // asChild renders the single child element (e.g. a next/link <Link>) AS the
  // styled control, so we never nest a <button> inside an <a> — invalid HTML
  // that breaks hydration and can kill interactivity. The child (anchor)
  // receives the button classes/styles directly.
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>;
    return React.cloneElement(child, {
      className: cn(classes, child.props.className),
      style: { ...mergedStyle, ...(child.props.style || {}) },
      ref,
      ...props,
    });
  }
  return (
    <button
      ref={ref}
      className={classes}
      style={mergedStyle}
      {...props}
    >
      {children}
    </button>
  );
});
EButton.displayName = "EButton";

/* ── Card ──────────────────────────────────────────────────────────────── */
export function ECard({
  variant = "default",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "ceremony" }) {
  return (
    <div
      className={cn(
        "rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))]",
        variant === "ceremony"
          ? "border border-[hsl(var(--e-border-gold)/0.4)] shadow-[var(--e-elevation-gold)]"
          : "border border-[hsl(var(--e-border))]",
        className
      )}
      {...props}
    />
  );
}
export function ECardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-6", className)} {...props} />;
}
export function ECardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-[1.125rem] font-semibold tracking-[-0.01em]", className)} {...props} />;
}
export function ECardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

/* ── Eyebrow ───────────────────────────────────────────────────────────── */
export function EEyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("e-eyebrow", className)} {...props} />;
}

/* ── Badge / StatusPill ────────────────────────────────────────────────── */
type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";
const TONE_DOT: Record<Tone, string> = {
  neutral: "hsl(var(--e-muted-foreground))",
  primary: "hsl(var(--e-accent-portal))",
  gold: "hsl(var(--e-gold))",
  success: "hsl(var(--e-success))",
  warning: "hsl(var(--e-warning))",
  danger: "hsl(var(--e-danger))",
  info: "hsl(var(--e-info))",
  aubergine: "hsl(284 22% 44%)",
};
export function EBadge({
  tone = "neutral",
  soft = false,
  className,
  children,
}: {
  tone?: Tone;
  soft?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] px-2.5 py-0.5 text-[0.6875rem] font-[550] tracking-[0.02em]",
        soft ? "text-[hsl(var(--e-foreground))]" : "border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]",
        className
      )}
      style={soft ? { backgroundColor: `color-mix(in srgb, ${TONE_DOT[tone]} 14%, transparent)` } : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT[tone] }} />
      {children}
    </span>
  );
}

/* ── PageHeader (eyebrow → serif h1 → desc → actions + signature rule) ──── */
export function EPageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <EEyebrow className="mb-1.5">{eyebrow}</EEyebrow> : null}
          <h1 className="e-display-md truncate">{title}</h1>
          {description ? (
            <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="e-signature-rule" />
    </div>
  );
}

/* ── StatCard (serif numeral, hairline icon ring, plain delta) ─────────── */
export function EStatCard({
  label,
  value,
  delta,
  deltaTone = "success",
  icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaTone?: "success" | "danger" | "neutral";
  icon?: React.ReactNode;
  className?: string;
}) {
  const deltaColor =
    deltaTone === "success" ? "hsl(var(--e-success))" : deltaTone === "danger" ? "hsl(var(--e-danger))" : "hsl(var(--e-muted-foreground))";
  return (
    <ECard className={cn("p-5", className)}>
      <div className="flex items-start justify-between">
        <EEyebrow>{label}</EEyebrow>
        {icon ? (
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="e-numeral mt-2 text-[1.75rem] leading-none">{value}</p>
      {delta ? (
        <p className="mt-1.5 text-[0.8125rem] font-medium" style={{ color: deltaColor }}>
          {delta}
        </p>
      ) : null}
    </ECard>
  );
}

/* ── Separator / ornament ──────────────────────────────────────────────── */
export function EThread({ className }: { className?: string }) {
  return <hr className={cn("e-thread", className)} />;
}

/* ── Alert / callout ───────────────────────────────────────────────────── */
export function EAlert({
  tone = "info",
  title,
  className,
  children,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const map = {
    info: ["--e-info", "--e-info-soft"],
    success: ["--e-success", "--e-success-soft"],
    warning: ["--e-warning", "--e-warning-soft"],
    danger: ["--e-danger", "--e-danger-soft"],
  }[tone];
  return (
    <div
      className={cn("rounded-[var(--e-radius-lg)] border-l-[3px] p-4", className)}
      style={{
        backgroundColor: `hsl(var(${map[1]}))`,
        borderColor: `hsl(var(${map[0]}))`,
        color: `hsl(var(--e-foreground))`,
      }}
    >
      {title ? <p className="text-[0.875rem] font-semibold">{title}</p> : null}
      {children ? <div className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{children}</div> : null}
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */
export function EEmptyState({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-14 text-center",
        className
      )}
    >
      {eyebrow ? <EEyebrow>{eyebrow}</EEyebrow> : null}
      <p className="e-display-sm">{title}</p>
      {description ? (
        <p className="max-w-sm text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
