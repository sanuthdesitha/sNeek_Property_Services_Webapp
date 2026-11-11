"use client";

/**
 * "How often": every clean, or every Nth completed clean of the property
 * (frequency "ROTATIONAL" + rotationEveryNCleans — the keys the property
 * checklist profile writes and lib/accountability/rotation-schema.ts reads).
 * A question generated as "shown when an exception is reported"
 * (frequency "CONDITIONAL") keeps that value until changed here.
 */
import * as React from "react";
import { EField, ESelect } from "@/components/v2/admin/estate-kit";
import { ordinal } from "@/lib/forms/question-badges";
import type { Cadence } from "@/lib/forms/multi-edit";
import { ROTATION_MAX_CLEANS, ROTATION_MIN_CLEANS } from "@/lib/forms/types";

const STEPS = Array.from({ length: ROTATION_MAX_CLEANS - ROTATION_MIN_CLEANS + 1 }, (_, index) => ROTATION_MIN_CLEANS + index);

export function cadenceToValue(cadence: Cadence | null): string {
  if (cadence === null) return "__mixed";
  return typeof cadence === "number" ? String(cadence) : cadence;
}

export function CadenceControl({
  id,
  value,
  onChange,
}: {
  id?: string;
  /** null = mixed (several questions with different cadences). */
  value: Cadence | null;
  onChange: (next: Cadence) => void;
}) {
  const current = cadenceToValue(value);
  const custom = typeof value === "number" && !STEPS.includes(value);
  return (
    <EField label="How often" hint="Rotation is counted per property; a rotating question appears only on the clean it is due.">
      <ESelect
        id={id}
        value={current}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "every" || raw === "conditional") onChange(raw);
          else if (raw !== "__mixed") onChange(Number(raw));
        }}
      >
        {value === null ? <option value="__mixed">Mixed: keep each as is</option> : null}
        <option value="every">Every clean</option>
        {STEPS.map((step) => (
          <option key={step} value={String(step)}>
            Every {ordinal(step)} clean
          </option>
        ))}
        {custom ? <option value={String(value)}>Every {ordinal(value as number)} clean</option> : null}
        {value === "conditional" ? <option value="conditional">When an exception is reported (from the checklist)</option> : null}
      </ESelect>
    </EField>
  );
}
