"use client";

/**
 * The recurring rules of one property, read from the existing recurring-rule
 * API (`GET /api/admin/recurring-jobs`, the store the nightly generator
 * reads). Shown on the property page and under New job → Repeats. Read only:
 * rules are created on the New job page.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { jobTypeLabel } from "@/lib/jobs/new-job/draft";

export type RecurringRuleRow = {
  id: string;
  name: string;
  isActive: boolean;
  propertyId: string;
  jobType: string;
  daysOfWeek: number[];
  startDate?: string;
  endDate?: string;
  startTime?: string;
  dueTime?: string;
  estimatedHours?: number;
  assigneeIds: string[];
};

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ruleDaysText(days: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.filter((day) => days.includes(day)).map((day) => WEEKDAY_SHORT[day]).join(", ");
}

type LoadState = { status: "loading" | "ready" | "error" | "forbidden"; rules: RecurringRuleRow[] };

export function useRecurringRules(propertyId: string, refreshKey = 0): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading", rules: [] });
  useEffect(() => {
    if (!propertyId) {
      setState({ status: "ready", rules: [] });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", rules: [] });
    fetch("/api/admin/recurring-jobs", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (response.status === 403) return setState({ status: "forbidden", rules: [] });
        if (!response.ok || !Array.isArray(body)) return setState({ status: "error", rules: [] });
        setState({ status: "ready", rules: (body as RecurringRuleRow[]).filter((rule) => rule.propertyId === propertyId) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error", rules: [] });
      });
    return () => controller.abort();
  }, [propertyId, refreshKey]);
  return state;
}

export function RecurringRulesList({ propertyId, refreshKey = 0, showCreateLink = false }: { propertyId: string; refreshKey?: number; showCreateLink?: boolean }) {
  const state = useRecurringRules(propertyId, refreshKey);
  return (
    <div className="space-y-2 text-[0.8125rem]">
      {state.status === "loading" ? <p className="text-[hsl(var(--e-text-secondary))]">Loading recurring rules…</p> : null}
      {state.status === "forbidden" ? <p className="text-[hsl(var(--e-text-secondary))]">Recurring rules belong to Calendar; your access does not include them.</p> : null}
      {state.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">Recurring rules could not be loaded.</p> : null}
      {state.status === "ready" && state.rules.length === 0 ? <p className="text-[hsl(var(--e-text-secondary))]">No recurring rules for this property.</p> : null}
      {state.rules.length ? (
        <ul className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {state.rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="font-[550]">{jobTypeLabel(rule.jobType)}</span> · {ruleDaysText(rule.daysOfWeek)}
                {rule.startTime ? ` · ${rule.startTime}` : ""}
                {rule.estimatedHours ? ` · ${rule.estimatedHours.toFixed(2)} h` : ""}
                <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  {rule.startDate ? `From ${rule.startDate}` : "From now"}{rule.endDate ? ` until ${rule.endDate}` : ", no end date"}
                  {rule.assigneeIds.length ? ` · ${rule.assigneeIds.length} cleaner${rule.assigneeIds.length === 1 ? "" : "s"}` : " · preferred cleaner offered"}
                </span>
              </span>
              <span className="rounded-full bg-[hsl(var(--e-muted))] px-2 py-0.5 text-[0.6875rem]">{rule.isActive ? "Active" : "Paused"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {showCreateLink ? (
        <Link className="inline-block text-[hsl(var(--e-primary))] underline" href={`/v2/admin/jobs/new?propertyId=${encodeURIComponent(propertyId)}&mode=repeats`}>New repeating job</Link>
      ) : null}
    </div>
  );
}
