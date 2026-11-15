"use client";

/**
 * Results and stats: the form picker and the range (4 / 8 / 12 / 26 weeks).
 * Both live in the URL (`templateId`, `weeks`, plus `tab=stats`), so the old
 * /v2/admin/forms/stats?templateId=…&weeks=… links keep opening the same view.
 * Changing the form resets the question sort and "Show all".
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { statsHref } from "./form-stats-rows";

export type FormStatsControlsProps = {
  templates: ReadonlyArray<{ id: string; name: string; version: number }>;
  templateId: string | undefined;
  weeks: number;
  weekChoices: readonly number[];
};

const SEGMENT_CLASS =
  "inline-flex min-h-9 items-center justify-center px-3 text-[0.8125rem] font-[550] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] max-sm:min-h-11 max-sm:flex-1";

export function FormStatsControls({ templates, templateId, weeks, weekChoices }: FormStatsControlsProps) {
  const router = useRouter();
  const selectId = React.useId();
  const rangeId = React.useId();
  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3 max-sm:w-full">
      <div className="min-w-0 space-y-1.5 max-sm:w-full">
        <label htmlFor={selectId} className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
          Form
        </label>
        <select
          id={selectId}
          value={templateId ?? ""}
          onChange={(event) => router.push(statsHref({ templateId: event.target.value, weeks }))}
          className="h-10 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] text-[hsl(var(--e-foreground))] focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] sm:w-72 max-sm:h-11 max-sm:text-base"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} (v{template.version})
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5 max-sm:w-full">
        <span id={rangeId} className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
          Range
        </span>
        <div role="group" aria-labelledby={rangeId} className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))]">
          {weekChoices.map((choice, index) => {
            const active = choice === weeks;
            return (
              <Link
                key={choice}
                href={statsHref({ templateId, weeks: choice })}
                scroll={false}
                aria-current={active ? "true" : undefined}
                className={cn(
                  SEGMENT_CLASS,
                  index > 0 && "border-l border-[hsl(var(--e-border))]",
                  active
                    ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-surface-raised))]",
                )}
              >
                {choice} wks
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
