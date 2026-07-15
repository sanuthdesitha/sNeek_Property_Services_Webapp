"use client";

/**
 * Settings → Accountability. Admin editor for AppSettings.accountability:
 * scoring deductions + rating bands, quality bonuses, rework rectification
 * bands, the issue-category taxonomy, recurring-pattern thresholds, and the two
 * job gates. Saves the whole blob via PATCH /api/admin/settings (the server
 * sanitizer clamps every value in sanitizeAccountabilitySettings).
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";
import type { AccountabilitySettings } from "@/lib/settings";

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function AccountabilitySection({
  initial,
  readOnly,
}: {
  initial: AccountabilitySettings;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<AccountabilitySettings>(() =>
    JSON.parse(JSON.stringify(initial))
  );
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function patchScoring(changes: Partial<AccountabilitySettings["scoring"]>) {
    setDraft((prev) => ({ ...prev, scoring: { ...prev.scoring, ...changes } }));
  }
  function patchBonuses(changes: Partial<AccountabilitySettings["bonuses"]>) {
    setDraft((prev) => ({ ...prev, bonuses: { ...prev.bonuses, ...changes } }));
  }
  function patchRect(changes: Partial<AccountabilitySettings["rectification"]>) {
    setDraft((prev) => ({ ...prev, rectification: { ...prev.rectification, ...changes } }));
  }

  function addBand() {
    setDraft((prev) => ({
      ...prev,
      rectification: {
        ...prev.rectification,
        bands: [...prev.rectification.bands, { maxMinutes: 0, amount: 0 }],
      },
    }));
  }
  function updateBand(idx: number, changes: Partial<{ maxMinutes: number; amount: number }>) {
    setDraft((prev) => ({
      ...prev,
      rectification: {
        ...prev.rectification,
        bands: prev.rectification.bands.map((b, i) => (i === idx ? { ...b, ...changes } : b)),
      },
    }));
  }
  function removeBand(idx: number) {
    setDraft((prev) => ({
      ...prev,
      rectification: {
        ...prev.rectification,
        bands: prev.rectification.bands.filter((_, i) => i !== idx),
      },
    }));
  }

  function addCategory() {
    setDraft((prev) => ({
      ...prev,
      issueCategories: [...prev.issueCategories, { key: "", label: "" }],
    }));
  }
  function updateCategory(idx: number, changes: Partial<{ key: string; label: string }>) {
    setDraft((prev) => ({
      ...prev,
      issueCategories: prev.issueCategories.map((c, i) => (i === idx ? { ...c, ...changes } : c)),
    }));
  }
  function removeCategory(idx: number) {
    setDraft((prev) => ({
      ...prev,
      issueCategories: prev.issueCategories.filter((_, i) => i !== idx),
    }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      // Normalise category keys (slugify blank/dirty keys from their label).
      const cleaned: AccountabilitySettings = {
        ...draft,
        issueCategories: draft.issueCategories
          .map((c) => {
            const key = slugify(c.key || c.label);
            return { key, label: (c.label || key).trim() };
          })
          .filter((c) => c.key.length > 0),
      };
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountability: cleaned }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Accountability settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  const s = draft.scoring;
  const b = draft.bonuses;
  const r = draft.rectification;

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Quality"
        title="Accountability"
        description="How QA inspections score cleaners, what earns a quality bonus, how rework rectification is paid, the issue taxonomy, recurring-pattern thresholds, and the job gates."
      />

      {/* ── Scoring ─────────────────────────────────────────────────────────── */}
      <ECard className="space-y-5 p-5">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Scoring deductions</h3>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Points removed from 100 per issue verdict. Score is floored at the value below.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <EField label="Minor deduction">
            <EInput type="number" min={0} step="1" value={String(s.minorDeduction)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ minorDeduction: num(e.target.value, s.minorDeduction) })} />
          </EField>
          <EField label="Major deduction">
            <EInput type="number" min={0} step="1" value={String(s.majorDeduction)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ majorDeduction: num(e.target.value, s.majorDeduction) })} />
          </EField>
          <EField label="Critical deduction">
            <EInput type="number" min={0} step="1" value={String(s.criticalDeduction)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ criticalDeduction: num(e.target.value, s.criticalDeduction) })} />
          </EField>
          <EField label="Missing mandatory evidence">
            <EInput type="number" min={0} step="1" value={String(s.missingMandatoryEvidenceDeduction)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ missingMandatoryEvidenceDeduction: num(e.target.value, s.missingMandatoryEvidenceDeduction) })} />
          </EField>
          <EField label="False-confirmation extra">
            <EInput type="number" min={0} step="1" value={String(s.falseConfirmationExtraDeduction)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ falseConfirmationExtraDeduction: num(e.target.value, s.falseConfirmationExtraDeduction) })} />
          </EField>
          <EField label="Score floor">
            <EInput type="number" min={0} step="1" value={String(s.floor)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ floor: num(e.target.value, s.floor) })} />
          </EField>
        </div>

        <div>
          <h3 className="text-[0.9375rem] font-semibold">Rating thresholds</h3>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Minimum score for each band. ≥ Excellent → EXCELLENT, ≥ Pass → PASS, ≥ Needs-improvement → NEEDS_IMPROVEMENT, else FAILED.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <EField label="Excellent min">
            <EInput type="number" min={0} step="1" value={String(s.excellentMin)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ excellentMin: num(e.target.value, s.excellentMin) })} />
          </EField>
          <EField label="Pass min">
            <EInput type="number" min={0} step="1" value={String(s.passMin)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ passMin: num(e.target.value, s.passMin) })} />
          </EField>
          <EField label="Needs-improvement min">
            <EInput type="number" min={0} step="1" value={String(s.needsImprovementMin)}
              disabled={readOnly}
              onChange={(e) => patchScoring({ needsImprovementMin: num(e.target.value, s.needsImprovementMin) })} />
          </EField>
        </div>
        <EToggle
          checked={s.criticalTriggersManagementReview}
          disabled={readOnly}
          onChange={(v) => patchScoring({ criticalTriggersManagementReview: v })}
          label="Critical issues trigger management review"
          description="A CRITICAL verdict routes the review to management regardless of the numeric score."
        />
      </ECard>

      {/* ── Bonuses ─────────────────────────────────────────────────────────── */}
      <ECard className="space-y-5 p-5">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Quality bonuses</h3>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Streak and monthly-ranking bonuses (auto-proposed as PENDING pay adjustments; a manager approves before payroll).
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <EField label="Streak length" hint="Consecutive high-quality cleans.">
            <EInput type="number" min={0} step="1" value={String(b.streakLength)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ streakLength: num(e.target.value, b.streakLength) })} />
          </EField>
          <EField label="Streak amount ($)">
            <EInput type="number" min={0} step="1" value={String(b.streakAmount)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ streakAmount: num(e.target.value, b.streakAmount) })} />
          </EField>
          <EField label="Min score for streak">
            <EInput type="number" min={0} step="1" value={String(b.streakMinScore)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ streakMinScore: num(e.target.value, b.streakMinScore) })} />
          </EField>
          <EField label="Extended streak length">
            <EInput type="number" min={0} step="1" value={String(b.extendedStreakLength)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ extendedStreakLength: num(e.target.value, b.extendedStreakLength) })} />
          </EField>
          <EField label="Extended streak amount ($)">
            <EInput type="number" min={0} step="1" value={String(b.extendedStreakAmount)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ extendedStreakAmount: num(e.target.value, b.extendedStreakAmount) })} />
          </EField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <EField label="Monthly #1 amount ($)">
            <EInput type="number" min={0} step="1" value={String(b.monthlyFirstAmount)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ monthlyFirstAmount: num(e.target.value, b.monthlyFirstAmount) })} />
          </EField>
          <EField label="Monthly #2 amount ($)">
            <EInput type="number" min={0} step="1" value={String(b.monthlySecondAmount)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ monthlySecondAmount: num(e.target.value, b.monthlySecondAmount) })} />
          </EField>
          <EField label="Min cleans / month">
            <EInput type="number" min={0} step="1" value={String(b.monthlyMinCleans)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ monthlyMinCleans: num(e.target.value, b.monthlyMinCleans) })} />
          </EField>
          <EField label="Min avg score / month">
            <EInput type="number" min={0} step="1" value={String(b.monthlyMinAvgScore)}
              disabled={readOnly}
              onChange={(e) => patchBonuses({ monthlyMinAvgScore: num(e.target.value, b.monthlyMinAvgScore) })} />
          </EField>
        </div>
      </ECard>

      {/* ── Rectification ───────────────────────────────────────────────────── */}
      <ECard className="space-y-5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[0.9375rem] font-semibold">Rework rectification bands</h3>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Deduction applied to a cleaner when QA rectifies their work, by how long it took. Sorted by minutes on save.
            </p>
          </div>
          {!readOnly ? (
            <EButton size="sm" variant="outline-gold" onClick={addBand}>
              <Plus className="h-4 w-4" /> Add band
            </EButton>
          ) : null}
        </div>
        <div className="space-y-3">
          {r.bands.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
              No bands — a default set is restored on save.
            </p>
          ) : (
            r.bands.map((band, idx) => (
              <div key={idx} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <EField label="Up to (minutes)">
                  <EInput type="number" min={0} step="1" value={String(band.maxMinutes)}
                    disabled={readOnly}
                    onChange={(e) => updateBand(idx, { maxMinutes: num(e.target.value, band.maxMinutes) })} />
                </EField>
                <EField label="Deduction ($)">
                  <EInput type="number" min={0} step="1" value={String(band.amount)}
                    disabled={readOnly}
                    onChange={(e) => updateBand(idx, { amount: num(e.target.value, band.amount) })} />
                </EField>
                {!readOnly ? (
                  <EButton size="icon" variant="ghost" onClick={() => removeBand(idx)} aria-label="Remove band">
                    <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                  </EButton>
                ) : null}
              </div>
            ))
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Manager review over (minutes)" hint="Rework beyond this needs manager review.">
            <EInput type="number" min={0} step="1" value={String(r.managerReviewOverMinutes)}
              disabled={readOnly}
              onChange={(e) => patchRect({ managerReviewOverMinutes: num(e.target.value, r.managerReviewOverMinutes) })} />
          </EField>
        </div>
        <EToggle
          checked={r.reworkDeductionsRequireApproval}
          disabled={readOnly}
          onChange={(v) => patchRect({ reworkDeductionsRequireApproval: v })}
          label="Rework deductions require approval"
          description="A rework deduction is proposed as PENDING and a manager must approve it."
        />
      </ECard>

      {/* ── Issue categories ────────────────────────────────────────────────── */}
      <ECard className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[0.9375rem] font-semibold">Issue categories</h3>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              The taxonomy QA picks from when flagging an issue. Key is slugified on save; blank rows are dropped.
            </p>
          </div>
          {!readOnly ? (
            <EButton size="sm" variant="outline-gold" onClick={addCategory}>
              <Plus className="h-4 w-4" /> Add category
            </EButton>
          ) : null}
        </div>
        <div className="space-y-3">
          {draft.issueCategories.map((cat, idx) => (
            <div key={idx} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <EField label="Key">
                <EInput value={cat.key} placeholder="e.g. dusting"
                  disabled={readOnly}
                  onChange={(e) => updateCategory(idx, { key: e.target.value })} />
              </EField>
              <EField label="Label">
                <EInput value={cat.label} placeholder="e.g. Dusting"
                  disabled={readOnly}
                  onChange={(e) => updateCategory(idx, { label: e.target.value })} />
              </EField>
              {!readOnly ? (
                <EButton size="icon" variant="ghost" onClick={() => removeCategory(idx)} aria-label="Remove category">
                  <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                </EButton>
              ) : null}
            </div>
          ))}
        </div>
      </ECard>

      {/* ── Patterns + gates ────────────────────────────────────────────────── */}
      <ECard className="space-y-5 p-5">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Recurring-pattern thresholds</h3>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            When the same issue category recurs for a cleaner/property this many times within the window, it's a recurring pattern.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Same-category count">
            <EInput type="number" min={0} step="1" value={String(draft.patternSameCategoryCount)}
              disabled={readOnly}
              onChange={(e) => setDraft((prev) => ({ ...prev, patternSameCategoryCount: num(e.target.value, prev.patternSameCategoryCount) }))} />
          </EField>
          <EField label="Window (days)">
            <EInput type="number" min={0} step="1" value={String(draft.patternWindowDays)}
              disabled={readOnly}
              onChange={(e) => setDraft((prev) => ({ ...prev, patternWindowDays: num(e.target.value, prev.patternWindowDays) }))} />
          </EField>
        </div>

        <div>
          <h3 className="text-[0.9375rem] font-semibold">Job gates</h3>
        </div>
        <div className="grid gap-3">
          <EToggle
            checked={draft.requireJobStartConfirmation}
            disabled={readOnly}
            onChange={(v) => setDraft((prev) => ({ ...prev, requireJobStartConfirmation: v }))}
            label="Require job-start confirmation"
            description="Cleaners must confirm they've started before the job clock runs."
          />
          <EToggle
            checked={draft.selfInspectionBlocksSubmit}
            disabled={readOnly}
            onChange={(v) => setDraft((prev) => ({ ...prev, selfInspectionBlocksSubmit: v }))}
            label="Self-inspection blocks submit"
            description="A cleaner cannot submit until the self-inspection checklist is complete."
          />
        </div>
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
            Read-only — administrator access required to edit.
          </p>
        )}
      </div>
    </div>
  );
}
