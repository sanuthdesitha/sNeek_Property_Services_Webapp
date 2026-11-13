"use client";

/**
 * Completed history (Pipeline → "Completed history"): past runs over a date
 * range with search and status, exactly what the old Completed tab allowed,
 * plus "Active" so the old Active runs date-range list is still available.
 * Opening a run shows the same side panel as the lanes.
 */
import * as React from "react";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { LAUNDRY_STATUS_OPTIONS, isCompleted, mediaCount, statusLabel, type LaundryTaskDTO } from "./laundry-shared";
import { shortDay } from "./laundry-lane-card";
import type { LaundryFeed } from "./use-laundry-feed";

export type HistoryFilters = { search: string; status: string; show: "completed" | "active" | "all" | "voided"; start: string; end: string };

type Props = {
  feed: LaundryFeed;
  filters: HistoryFilters;
  onFilters: (patch: Partial<HistoryFilters>) => void;
  openId: string | null;
  onOpen: (task: LaundryTaskDTO) => void;
};

export function filterHistory(tasks: LaundryTaskDTO[], filters: HistoryFilters): LaundryTaskDTO[] {
  const needle = filters.search.toLowerCase();
  return tasks
    // Voided runs (2026-11-14) appear only under the Voided filter.
    .filter((task) => (filters.show === "voided" ? Boolean(task.voidedAt) : !task.voidedAt))
    .filter((task) => (filters.show === "all" || filters.show === "voided" ? true : filters.show === "completed" ? isCompleted(task) : !isCompleted(task)))
    .filter((task) => filters.status === "all" || task.status === filters.status)
    .filter((task) =>
      [task.property?.name, task.property?.address, task.property?.suburb, task.property?.client?.name, task.supplier?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .sort((a, b) =>
      filters.show === "active"
        ? new Date(a.pickupDate).getTime() - new Date(b.pickupDate).getTime()
        : new Date(b.dropoffDate).getTime() - new Date(a.dropoffDate).getTime(),
    );
}

export function LaundryHistory({ feed, filters, onFilters, openId, onOpen }: Props) {
  const rows = filterHistory(feed.tasks, filters);
  return (
    <section aria-label="Completed history" className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <EField label="Search">
          <EInput value={filters.search} onChange={(event) => onFilters({ search: event.target.value })} placeholder="Property, client or supplier" />
        </EField>
        <EField label="Show">
          <ESelect value={filters.show} onChange={(event) => onFilters({ show: event.target.value as HistoryFilters["show"] })}>
            <option value="completed">Completed (delivered or skipped)</option>
            <option value="active">Active runs</option>
            <option value="all">All runs</option>
            <option value="voided">Voided</option>
          </ESelect>
        </EField>
        <EField label="Status">
          <ESelect value={filters.status} onChange={(event) => onFilters({ status: event.target.value })}>
            <option value="all">All statuses</option>
            {LAUNDRY_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </ESelect>
        </EField>
        <EField label="From">
          <EInput type="date" value={filters.start} onChange={(event) => onFilters({ start: event.target.value })} />
        </EField>
        <EField label="Through">
          <EInput type="date" value={filters.end} onChange={(event) => onFilters({ end: event.target.value })} />
        </EField>
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Pickup or drop-off in the selected range, plus flagged runs. Dates use Sydney time.</p>
      {feed.status === "error" ? (
        <div role="alert" className="text-[0.875rem]">
          <p className="text-[hsl(var(--e-danger))]">{feed.error} Rows shown may be out of date.</p>
          <EButton size="sm" variant="outline" onClick={feed.reload}>Retry</EButton>
        </div>
      ) : null}
      {feed.status === "loading" && feed.tasks.length === 0 ? (
        <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading runs…</p>
      ) : rows.length === 0 && feed.status !== "error" ? (
        <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No runs match the selected dates and filters.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-busy={feed.status === "loading"}>
          {rows.map((task) => {
            const photos = mediaCount(task);
            return (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  aria-current={openId === task.id ? "true" : undefined}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5 text-left hover:bg-[hsl(var(--e-muted))]"
                >
                  <span className="min-w-0">
                    <b className={`break-words text-[0.875rem] ${task.voidedAt ? "text-[hsl(var(--e-muted-foreground))] line-through" : ""}`}>{task.property?.name ?? "Property"}</b>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Pickup {shortDay(task.pickupDate)} · Drop-off {shortDay(task.dropoffDate)}
                      {task.supplier?.name ? ` · ${task.supplier.name}` : ""}
                      {photos ? ` · ${photos} photo${photos === 1 ? "" : "s"}` : ""}
                      {task.dropoffCostAud != null ? ` · $${Number(task.dropoffCostAud).toFixed(2)}` : ""}
                    </span>
                  </span>
                  {task.voidedAt ? <EPill tone="neutral">Voided{task.voidReason ? ` · ${task.voidReason}` : ""}</EPill> : <EPill tone={task.status === "DROPPED" ? "ok" : task.status === "FLAGGED" ? "bad" : task.status === "SKIPPED_PICKUP" ? "warn" : "neutral"}>{statusLabel(task.status)}</EPill>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
