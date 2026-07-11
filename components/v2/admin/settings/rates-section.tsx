"use client";

import { useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ESelectNative,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";

/**
 * Cleaner hourly rates by job category. Same structure v1 uses:
 * cleanerJobHourlyRates[cleanerId][jobType] = number. Rendered per-cleaner via
 * a picker (matching the v1 editor), PATCHed under the identical key.
 */
export type CleanerOption = { id: string; name: string | null; email: string };

// JobType values, matched to v1's JOB_TYPES list (settings-editor.tsx).
const JOB_TYPES = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "MOVE_IN_CLEAN",
  "GENERAL_CLEAN",
  "POST_CONSTRUCTION",
  "PRESSURE_WASH",
  "WINDOW_CLEAN",
  "LAWN_MOWING",
  "SPECIAL_CLEAN",
  "COMMERCIAL_RECURRING",
] as const;

type RatesMap = Record<string, Record<string, number>>;

function cleanerLabel(c: CleanerOption) {
  if (c.name?.trim()) return `${c.name} (${c.email})`;
  return c.email;
}

export function RatesSection({
  cleaners,
  initialRates,
  readOnly,
}: {
  cleaners: CleanerOption[];
  initialRates: RatesMap;
  readOnly: boolean;
}) {
  const [rates, setRates] = useState<RatesMap>(initialRates ?? {});
  const [selectedCleanerId, setSelectedCleanerId] = useState(cleaners[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function getRateValue(cleanerId: string, jobType: string): string {
    const value = rates?.[cleanerId]?.[jobType];
    return value === undefined || value === null ? "" : String(value);
  }

  function setRate(cleanerId: string, jobType: string, rawValue: string) {
    const trimmed = rawValue.trim();
    setRates((prev) => {
      const existing = { ...(prev ?? {}) };
      const cleanerRates = { ...(existing[cleanerId] ?? {}) };
      if (!trimmed) {
        delete cleanerRates[jobType];
      } else {
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric) && numeric >= 0) {
          cleanerRates[jobType] = numeric;
        }
      }
      if (Object.keys(cleanerRates).length === 0) {
        delete existing[cleanerId];
      } else {
        existing[cleanerId] = cleanerRates;
      }
      return existing;
    });
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanerJobHourlyRates: rates }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Payroll"
        title="Cleaner hourly rates by job category"
        description="Applied automatically to assignment pay rates (JobAssignment.payRate) per job type."
      />

      <ECard className="p-6">
        {cleaners.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No active cleaners found.</p>
        ) : (
          <div className="space-y-5">
            <EField label="Select cleaner" className="max-w-md">
              <ESelectNative
                value={selectedCleanerId}
                onChange={(e) => setSelectedCleanerId(e.target.value)}
                disabled={readOnly}
              >
                {cleaners.map((c) => (
                  <option key={c.id} value={c.id}>
                    {cleanerLabel(c)}
                  </option>
                ))}
              </ESelectNative>
            </EField>

            {selectedCleanerId ? (
              <div className="grid gap-5 sm:grid-cols-2">
                {JOB_TYPES.map((jobType) => (
                  <EField key={jobType} label={jobType.replace(/_/g, " ")}>
                    <EInput
                      type="number"
                      min={0}
                      step="0.01"
                      value={getRateValue(selectedCleanerId, jobType)}
                      onChange={(e) => setRate(selectedCleanerId, jobType, e.target.value)}
                      disabled={readOnly}
                      placeholder="e.g. 30"
                    />
                  </EField>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
