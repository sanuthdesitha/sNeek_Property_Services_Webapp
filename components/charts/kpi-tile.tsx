import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "./sparkline";

type Tone = "primary" | "accent" | "success" | "warning" | "info" | "destructive" | "neutral";

const TONE_ICON: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  accent: "bg-accent/15 text-accent-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  destructive: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Sphere-UI KPI tile: glass card, big tabular value, optional delta badge and
 * inline sparkline. The whole tile can link somewhere.
 */
export function KpiTile({
  label,
  value,
  icon,
  tone = "primary",
  delta,
  deltaLabel,
  spark,
  href,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  /** Positive/negative percentage change; sign drives color + arrow. */
  delta?: number | null;
  deltaLabel?: string;
  spark?: Array<Record<string, number>>;
  href?: string;
  className?: string;
}) {
  const up = (delta ?? 0) >= 0;
  const sparkTone: Exclude<Tone, "neutral"> = tone === "neutral" ? "primary" : tone;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon ? (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-xl [&>svg]:h-4 [&>svg]:w-4", TONE_ICON[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
          {delta != null ? (
            <span
              className={cn(
                "mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
              )}
            >
              {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
              {deltaLabel ? <span className="font-normal text-muted-foreground"> {deltaLabel}</span> : null}
            </span>
          ) : null}
        </div>
        {spark && spark.length > 1 ? (
          <div className="hidden h-10 w-24 shrink-0 sm:block">
            <Sparkline data={spark} tone={sparkTone} height={40} />
          </div>
        ) : null}
      </div>
    </>
  );

  const shell = cn(
    // flex-col + h-full + justify-between => every tile fills its grid cell and
    // its value sits on the same baseline, so a row of tiles aligns cleanly even
    // when only some have a sparkline or a wrapped label.
    "relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-sm transition sm:p-5",
    href && "hover:-translate-y-0.5 hover:shadow-md",
    className,
  );

  return href ? (
    <Link href={href} className={shell}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
