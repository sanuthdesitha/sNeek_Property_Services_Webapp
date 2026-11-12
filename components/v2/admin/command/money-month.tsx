"use client";

/** "Money this month": rendered only for viewers with finance or payroll access. */
import Link from "next/link";
import { EPill } from "@/components/v2/ui/pill";
import type { MoneyPayload } from "@/lib/dashboard/command-types";
import { SectionBody } from "./section-state";
import { useCommandSection } from "./use-command-section";

/** Money moves slowly; five minutes keeps the payroll engine off the 30 s cycle. */
export const MONEY_REFRESH_MS = 5 * 60_000;

export function MoneyThisMonth({ initial, timeZone }: { initial: MoneyPayload | null; timeZone: string }) {
  const state = useCommandSection<MoneyPayload>("money", initial, MONEY_REFRESH_MS);
  return (
    <section aria-labelledby="money-month-title" className="min-w-0 space-y-2">
      <h2 id="money-month-title" className="text-[0.8125rem] font-[600]">Money this month</h2>
      <SectionBody state={state} label="Money this month" timeZone={timeZone} rows={3}>
        {(data) => (
          <>
            {data.unavailable.length > 0 ? (
              <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-warning))]">Could not read: {data.unavailable.join(", ")}.</p>
            ) : null}
            <dl className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)] gap-x-2.5 gap-y-2 text-[0.8125rem]">
              {data.rows.map((row) => (
                <div key={row.key} className="contents">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">{row.label}</dt>
                  <dd className="min-w-0">
                    <Link href={row.href} className="e-tnum inline-flex flex-wrap items-center gap-2 text-[hsl(var(--e-foreground))] hover:underline">
                      {row.value}
                      {row.badge ? <EPill tone={row.badge.tone}>{row.badge.text}</EPill> : null}
                    </Link>
                    {row.note ? <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{row.note}</p> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </SectionBody>
    </section>
  );
}
