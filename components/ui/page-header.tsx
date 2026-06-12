import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Standard page header used across every portal so titles, descriptions,
 * and action buttons sit in the same place on every screen.
 *
 * <PageHeader
 *   title="Jobs"
 *   description="Schedule, assign, and track every clean."
 *   actions={<Button>New job</Button>}
 * />
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
          {icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">
              {icon}
            </span>
          ) : null}
          <span className="truncate">{title}</span>
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
