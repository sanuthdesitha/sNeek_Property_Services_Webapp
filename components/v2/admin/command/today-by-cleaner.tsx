"use client";

/**
 * Today by cleaner: each cleaner's jobs on an hour axis. Every state has its
 * own shape (solid, striped, outlined, dashed, dotted) and a written label in
 * the legend, the tooltip and the table view, so colour never carries it alone.
 */
import type * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { StripSegment, StripState, TodayByCleanerPayload } from "@/lib/dashboard/command-types";
import { stripStateLabel } from "@/lib/dashboard/today-by-cleaner";
import { SectionBody } from "./section-state";
import { useCommandSection } from "./use-command-section";

const SHAPE: Record<StripState, string> = {
  done: "bg-[hsl(var(--e-success))]",
  "on-site": "bg-[hsl(var(--e-info))]",
  late: "",
  "off-site": "",
  travelling: "border-2 border-dotted border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))]",
  planned: "bg-[hsl(var(--e-border-strong))]",
  "not-started": "border-2 border-[hsl(var(--e-warning))] bg-transparent",
  unassigned: "border-[1.5px] border-dashed border-[hsl(var(--e-danger))] bg-transparent",
};

/** Striped fills (late, off site), set inline so the gradient is not read as a colour. */
const STRIPES: Partial<Record<StripState, React.CSSProperties>> = {
  late: { backgroundImage: "repeating-linear-gradient(135deg, hsl(var(--e-warning)) 0 4px, hsl(var(--e-warning) / 0.45) 4px 8px)" },
  "off-site": { backgroundImage: "repeating-linear-gradient(45deg, hsl(var(--e-danger)) 0 4px, hsl(var(--e-danger) / 0.45) 4px 8px)" },
};

const LEGEND: StripState[] = ["done", "on-site", "travelling", "late", "off-site", "not-started", "planned", "unassigned"];

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return String(h);
}

function Segment({ segment, start, span }: { segment: StripSegment; start: number; span: number }) {
  const left = ((segment.startMinute - start) / span) * 100;
  const width = Math.max(1.5, ((segment.endMinute - segment.startMinute) / span) * 100);
  return (
    <Link
      href={`/v2/admin/jobs/${segment.jobId}`}
      title={`${segment.label}${segment.lengthAssumed ? " (length not recorded)" : ""}`}
      aria-label={`${segment.label}${segment.lengthAssumed ? ", length not recorded" : ""}`}
      className={cn("absolute bottom-[3px] top-[3px] rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]", SHAPE[segment.state], segment.lengthAssumed && "opacity-70")}
      style={{ ...STRIPES[segment.state], left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
    />
  );
}

function StripTable({ data }: { data: TodayByCleanerPayload }) {
  return (
    <details className="text-[0.8125rem]">
      <summary className="cursor-pointer text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">Show as a table</summary>
      <div className="mt-2 max-h-64 overflow-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        <table className="w-full text-left text-[0.75rem]">
          <caption className="sr-only">Today&apos;s jobs by cleaner</caption>
          <thead><tr className="bg-[hsl(var(--e-surface-raised))]"><th className="px-2 py-1.5">Cleaner</th><th className="px-2 py-1.5">Time</th><th className="px-2 py-1.5">Job</th><th className="px-2 py-1.5">State</th></tr></thead>
          <tbody>
            {data.rows.flatMap((row) => row.segments.map((segment) => (
              <tr key={`${row.key}:${segment.jobId}`} className="border-t border-[hsl(var(--e-border))]">
                <td className="px-2 py-1.5">{row.name}</td>
                <td className="e-tnum px-2 py-1.5">{clock(segment.startMinute)}{segment.lengthAssumed ? "" : `–${clock(segment.endMinute)}`}</td>
                <td className="px-2 py-1.5"><Link href={`/v2/admin/jobs/${segment.jobId}`} className="hover:underline">{segment.label.split(" · ")[0]}</Link></td>
                <td className="px-2 py-1.5">{stripStateLabel(segment.state)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function TodayByCleaner({ initial, timeZone }: { initial: TodayByCleanerPayload | null; timeZone: string }) {
  const state = useCommandSection<TodayByCleanerPayload>("cleaners", initial);
  return (
    <div className="min-w-0">
      <SectionBody state={state} label="Today by cleaner" timeZone={timeZone} rows={4}>
        {(data) => {
          const start = data.axisStartHour * 60;
          const span = Math.max(60, data.axisEndHour * 60 - start);
          const hours = Array.from({ length: data.axisEndHour - data.axisStartHour + 1 }, (_, i) => data.axisStartHour + i).filter((_, i, all) => all.length <= 8 || i % 2 === 0);
          if (data.rows.length === 0) {
            return <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{data.withoutStartTime > 0 ? `${data.withoutStartTime} job${data.withoutStartTime === 1 ? "" : "s"} today, none with a start time.` : "No jobs scheduled today."}</p>;
          }
          return (
            <div className="space-y-3">
              <div aria-hidden className="e-tnum flex justify-between pl-[92px] text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                {hours.map((hour) => <span key={hour}>{hourLabel(hour)}</span>)}
              </div>
              <ul aria-label="Jobs by cleaner on a time axis" className="space-y-3">
                {data.rows.map((row) => (
                  <li key={row.key} className="flex items-center gap-3">
                    <span className={cn("w-20 shrink-0 truncate text-[0.8125rem]", row.unassigned && "font-[600] text-[hsl(var(--e-danger))]")}>{row.name}</span>
                    <div className={cn("relative h-[22px] min-w-0 flex-1 rounded-[6px]", row.unassigned ? "bg-[hsl(var(--e-danger-soft))]" : "bg-[hsl(var(--e-surface-raised))]")}>
                      {row.segments.map((segment) => <Segment key={segment.jobId} segment={segment} start={start} span={span} />)}
                    </div>
                  </li>
                ))}
              </ul>
              <ul aria-label="Legend" className="flex flex-wrap gap-x-3 gap-y-1.5 text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">
                {LEGEND.map((key) => (
                  <li key={key} className="inline-flex items-center gap-1.5"><span aria-hidden className={cn("inline-block h-3 w-5 rounded-[3px]", SHAPE[key])} style={STRIPES[key]} />{stripStateLabel(key)}</li>
                ))}
              </ul>
              {data.withoutStartTime > 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{data.withoutStartTime} job{data.withoutStartTime === 1 ? " has" : "s have"} no start time and {data.withoutStartTime === 1 ? "is" : "are"} not drawn.</p> : null}
              <StripTable data={data} />
            </div>
          );
        }}
      </SectionBody>
    </div>
  );
}
