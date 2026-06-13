import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Glass "Sphere UI" surface for a chart or analytics module: rounded-2xl,
 * soft layered shadow, hairline border, and a faint top-light gradient sheen.
 * Used as the wrapper for every chart in the webapp dashboards.
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-surface shadow-md",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-24",
        "before:bg-[radial-gradient(120%_100%_at_50%_0%,hsl(var(--primary)/0.06),transparent_70%)]",
        className,
      )}
    >
      {(title || actions) && (
        <div className="relative flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
            ) : null}
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={cn("relative px-2 pb-2 pt-3", bodyClassName)}>{children}</div>
    </div>
  );
}
