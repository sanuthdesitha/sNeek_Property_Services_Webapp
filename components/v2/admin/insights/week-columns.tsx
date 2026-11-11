"use client";

/**
 * Column chart by week, one or two series, as drawn ("Revenue and cleaner cost
 * by week"). Accessible without colour: the series differ by fill AND pattern
 * (the second is hatched), the legend names them in text, every bar carries
 * its value as text for screen readers and as a tooltip, and the same numbers
 * are available as a table under "Show as a table". A week without data is a
 * gap marked "no data", never a zero-height bar pretending to be zero.
 * The chart scrolls in its own box on a narrow screen.
 */
import * as React from "react";
import { formatAud } from "@/lib/insights/format";

export type ChartSeries = { label: string; kind: "primary" | "gold" };
export type ChartWeek = { key: string; label: string; values: Array<number | null>; note?: string };

const FILL: Record<ChartSeries["kind"], React.CSSProperties> = {
  primary: { background: "hsl(var(--e-primary))" },
  gold: {
    background:
      "repeating-linear-gradient(135deg, hsl(var(--e-gold)) 0 4px, hsl(var(--e-gold) / 0.65) 4px 7px)",
  },
};

const CHART_HEIGHT = 120;

export function WeekColumns({ title, series, weeks }: { title: string; series: ChartSeries[]; weeks: ChartWeek[] }) {
  const max = Math.max(0, ...weeks.flatMap((week) => week.values.filter((value): value is number => value !== null)));
  const hasData = max > 0;
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap items-center gap-3 text-[0.75rem]" aria-label="Legend">
        {series.map((item) => (
          <li key={item.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-[2px]" style={FILL[item.kind]} />
            {item.label}
          </li>
        ))}
      </ul>
      {hasData ? (
        <div className="overflow-x-auto">
          <div role="group" aria-label={title} className="flex min-w-[18rem] items-end gap-3" style={{ height: CHART_HEIGHT + 20 }}>
            {weeks.map((week) => (
              <div key={week.key} className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
                <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
                  {week.values.map((value, index) => {
                    const label = `${series[index].label}, week of ${week.label}: ${value === null ? "no data" : formatAud(value)}`;
                    if (value === null) {
                      return (
                        <span key={index} className="flex-1 self-end text-center text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                          <span aria-hidden>–</span>
                          <span className="sr-only">{label}</span>
                        </span>
                      );
                    }
                    const height = Math.max(2, Math.round((value / max) * CHART_HEIGHT));
                    return (
                      <span key={index} title={label} className="block flex-1 rounded-t-[3px]" style={{ ...FILL[series[index].kind], height }}>
                        <span className="sr-only">{label}</span>
                      </span>
                    );
                  })}
                </div>
                <span aria-hidden className="truncate text-center text-[0.6875rem] text-[hsl(var(--e-muted-foreground))] e-tnum">
                  {week.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No week in this period has the data this chart needs.</p>
      )}
      <details className="text-[0.8125rem]">
        <summary className="cursor-pointer text-[hsl(var(--e-primary))]">Show as a table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[18rem] text-left">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                <th scope="col" className="py-1 pr-3 font-semibold">Week of</th>
                {series.map((item) => (
                  <th key={item.label} scope="col" className="py-1 pr-3 text-right font-semibold">{item.label}</th>
                ))}
                <th scope="col" className="py-1 font-semibold">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--e-border))]">
              {weeks.map((week) => (
                <tr key={week.key}>
                  <th scope="row" className="py-1 pr-3 font-normal e-tnum">{week.label}</th>
                  {week.values.map((value, index) => (
                    <td key={index} className="py-1 pr-3 text-right e-tnum">{value === null ? "No data" : formatAud(value)}</td>
                  ))}
                  <td className="py-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{week.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
