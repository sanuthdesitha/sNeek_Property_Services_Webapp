"use client";

/**
 * What a question's effect does, shown under the question on the phone.
 *
 *  live     "'Yes' opens a damage report": once the answer matches, the job's
 *           existing damage report (DamageReportForm, its own autosave and
 *           submit) opens right here with the area and category filled in.
 *  preview  the builder's phone and "Test as cleaner": the same words, saying
 *  sandbox  what WOULD happen. Nothing is opened, raised or written.
 *
 * The urgent stock effect has no phone step: the submit route raises the need
 * after the form is submitted. The cleaner is told so truthfully.
 */
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import * as React from "react";
import { AlertTriangle, Package } from "lucide-react";
import { DamageReportForm } from "@/components/v2/cleaner/damage-report-form";
import { damageEffectOf, urgentStockEffectOf, yesNoMatches } from "@/lib/forms/form-effects";
import { readStockCountAnswer } from "@/lib/forms/structured-answers";
import type { FormField } from "@/lib/forms/types";
import type { FormRenderMode } from "@/components/v2/cleaner/form-renderer";

/** The job the live form belongs to (damage report target); undefined in previews. */
export const FormJobContext = React.createContext<string | undefined>(undefined);

const NOTE = "rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]";

export function QuestionEffectNotice({
  field,
  value,
  sectionTitle,
  mode,
}: {
  field: FormField;
  value: unknown;
  sectionTitle: string;
  mode: FormRenderMode;
}) {
  const jobId = React.useContext(FormJobContext);
  const [open, setOpen] = React.useState(false);
  const damage = damageEffectOf(field);
  const urgent = urgentStockEffectOf(field);

  if (damage && yesNoMatches(value, damage.when)) {
    const area = damage.area?.trim() || field.locationTag?.trim() || sectionTitle;
    const category = damage.category?.trim() || "";
    if (mode !== "live" || !jobId) {
      return (
        <p className={`${NOTE} ${toneNoticeClass("attention")}`}>
          Would open a damage report{area ? ` for ${area}` : ""}. Nothing is reported in a preview.
        </p>
      );
    }
    return (
      <div className={`${NOTE} space-y-2 ${toneNoticeClass("attention")}`}>
        <p className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This answer needs a damage report. Add what was damaged and photos now. If you submit the form without one, the
            office still gets a damage case from this answer, without your details.
          </span>
        </p>
        {open ? (
          <DamageReportForm jobId={jobId} embedded prefill={{ area, category }} onSubmitted={() => setOpen(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-10 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3.5 font-[550]"
          >
            Open the damage report
          </button>
        )}
      </div>
    );
  }

  if (urgent) {
    const answer = readStockCountAnswer(value);
    if (!answer || answer.count >= urgent.threshold) return null;
    return (
      <p className={`${NOTE} flex items-start gap-1.5 ${toneNoticeClass("info")}`}>
        <Package className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {mode === "live"
          ? `Below ${urgent.threshold}: submitting raises an urgent stock need for the office. It does not order anything.`
          : `Would raise an urgent stock need (below ${urgent.threshold}). Nothing is raised in a preview.`}
      </p>
    );
  }
  return null;
}
