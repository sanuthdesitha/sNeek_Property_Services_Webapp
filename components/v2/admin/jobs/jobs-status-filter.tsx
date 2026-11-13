"use client";

/**
 * Status filter covering every JobStatus. "Any status" and "Active" (anything
 * not completed or invoiced) are the two groups the page has always had; any
 * other choice is a set of real statuses, sent to the server as a list.
 */
import { normalizeStatusChip, statusChipStatuses } from "@/lib/jobs/workspace-state";
import { statusLabel } from "./job-row";
import { ALL_JOB_STATUSES } from "./jobs-constants";

export function statusFilterLabel(value: string): string | null {
  if (value === "all") return null;
  if (value === "active") return "Active";
  const statuses = statusChipStatuses(value) ?? [];
  if (statuses.length <= 2) return statuses.map(statusLabel).join(", ");
  return `${statuses.length} statuses`;
}

/** Toggle one status in the current value; an empty set means "any status". */
export function toggleStatus(value: string, status: string): string {
  const current = new Set<string>(statusChipStatuses(value) ?? []);
  if (current.has(status)) current.delete(status);
  else current.add(status);
  if (current.size === 0) return "all";
  return normalizeStatusChip(Array.from(current).join(",")) ?? "all";
}

export function JobsStatusFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const chosen = new Set<string>(statusChipStatuses(value) ?? []);
  return (
    <div className="space-y-2 text-[0.8125rem]">
      <div className="flex flex-wrap gap-3">
        <label className="flex min-h-8 items-center gap-2 max-sm:min-h-11">
          <input type="radio" name="jobs-status-group" checked={value === "all"} onChange={() => onChange("all")} /> Any status
        </label>
        <label className="flex min-h-8 items-center gap-2 max-sm:min-h-11">
          <input type="radio" name="jobs-status-group" checked={value === "active"} onChange={() => onChange("active")} /> Active
        </label>
      </div>
      <fieldset className="grid grid-cols-1 gap-0.5">
        <legend className="mb-1 text-[0.6875rem] font-[600] text-[hsl(var(--e-text-secondary))]">Or choose statuses</legend>
        {ALL_JOB_STATUSES.map((status) => (
          <label key={status} className="flex min-h-8 items-center gap-2 max-sm:min-h-11">
            <input type="checkbox" checked={chosen.has(status)} onChange={() => onChange(toggleStatus(value, status))} />
            {statusLabel(status)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
