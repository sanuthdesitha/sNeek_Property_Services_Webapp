"use client";

/**
 * v1 Settings → Accountability. Admin editor for AppSettings.accountability
 * (scoring, bonuses, rectification bands, issue categories, pattern thresholds,
 * job gates). Saves the whole blob via PATCH /api/admin/settings; the server
 * sanitizer clamps every value in sanitizeAccountabilitySettings.
 */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { AccountabilitySettings } from "@/lib/settings";

function num(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}
function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function NumField({
  label,
  value,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      <Input
        type="number"
        min={0}
        step="1"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(num(e.target.value, value))}
      />
      {hint ? <p className="text-[0.7rem] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function AccountabilitySettingsEditor({
  initial,
  readOnly,
}: {
  initial: AccountabilitySettings;
  readOnly: boolean;
}) {
  const [draft, setDraft] = useState<AccountabilitySettings>(() => JSON.parse(JSON.stringify(initial)));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const s = draft.scoring;
  const b = draft.bonuses;
  const r = draft.rectification;

  function patchScoring(changes: Partial<AccountabilitySettings["scoring"]>) {
    setDraft((prev) => ({ ...prev, scoring: { ...prev.scoring, ...changes } }));
  }
  function patchBonuses(changes: Partial<AccountabilitySettings["bonuses"]>) {
    setDraft((prev) => ({ ...prev, bonuses: { ...prev.bonuses, ...changes } }));
  }
  function patchRect(changes: Partial<AccountabilitySettings["rectification"]>) {
    setDraft((prev) => ({ ...prev, rectification: { ...prev.rectification, ...changes } }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    setMessage(null);
    try {
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
        setMessage({ kind: "err", text: body.error ?? "Could not save settings." });
        return;
      }
      setMessage({ kind: "ok", text: "Accountability settings saved." });
    } catch {
      setMessage({ kind: "err", text: "Could not save settings." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Scoring */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scoring</CardTitle>
          <CardDescription>Deductions from 100 per verdict, the score floor, and the rating bands.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumField label="Minor deduction" value={s.minorDeduction} disabled={readOnly} onChange={(v) => patchScoring({ minorDeduction: v })} />
            <NumField label="Major deduction" value={s.majorDeduction} disabled={readOnly} onChange={(v) => patchScoring({ majorDeduction: v })} />
            <NumField label="Critical deduction" value={s.criticalDeduction} disabled={readOnly} onChange={(v) => patchScoring({ criticalDeduction: v })} />
            <NumField label="Missing mandatory evidence" value={s.missingMandatoryEvidenceDeduction} disabled={readOnly} onChange={(v) => patchScoring({ missingMandatoryEvidenceDeduction: v })} />
            <NumField label="False-confirmation extra" value={s.falseConfirmationExtraDeduction} disabled={readOnly} onChange={(v) => patchScoring({ falseConfirmationExtraDeduction: v })} />
            <NumField label="Score floor" value={s.floor} disabled={readOnly} onChange={(v) => patchScoring({ floor: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumField label="Excellent min" value={s.excellentMin} disabled={readOnly} onChange={(v) => patchScoring({ excellentMin: v })} />
            <NumField label="Pass min" value={s.passMin} disabled={readOnly} onChange={(v) => patchScoring({ passMin: v })} />
            <NumField label="Needs-improvement min" value={s.needsImprovementMin} disabled={readOnly} onChange={(v) => patchScoring({ needsImprovementMin: v })} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Critical issues trigger management review</p>
              <p className="text-xs text-muted-foreground">A CRITICAL verdict routes the review to management regardless of the score.</p>
            </div>
            <Switch checked={s.criticalTriggersManagementReview} disabled={readOnly} onCheckedChange={(v) => patchScoring({ criticalTriggersManagementReview: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Bonuses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quality bonuses</CardTitle>
          <CardDescription>Streak and monthly-ranking bonuses (auto-proposed as PENDING; a manager approves before payroll).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumField label="Streak length" value={b.streakLength} disabled={readOnly} onChange={(v) => patchBonuses({ streakLength: v })} />
            <NumField label="Streak amount ($)" value={b.streakAmount} disabled={readOnly} onChange={(v) => patchBonuses({ streakAmount: v })} />
            <NumField label="Min score for streak" value={b.streakMinScore} disabled={readOnly} onChange={(v) => patchBonuses({ streakMinScore: v })} />
            <NumField label="Extended streak length" value={b.extendedStreakLength} disabled={readOnly} onChange={(v) => patchBonuses({ extendedStreakLength: v })} />
            <NumField label="Extended streak amount ($)" value={b.extendedStreakAmount} disabled={readOnly} onChange={(v) => patchBonuses({ extendedStreakAmount: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumField label="Monthly #1 amount ($)" value={b.monthlyFirstAmount} disabled={readOnly} onChange={(v) => patchBonuses({ monthlyFirstAmount: v })} />
            <NumField label="Monthly #2 amount ($)" value={b.monthlySecondAmount} disabled={readOnly} onChange={(v) => patchBonuses({ monthlySecondAmount: v })} />
            <NumField label="Min cleans / month" value={b.monthlyMinCleans} disabled={readOnly} onChange={(v) => patchBonuses({ monthlyMinCleans: v })} />
            <NumField label="Min avg score / month" value={b.monthlyMinAvgScore} disabled={readOnly} onChange={(v) => patchBonuses({ monthlyMinAvgScore: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Rectification */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Rework rectification bands</CardTitle>
              <CardDescription>Deduction applied when QA rectifies a cleaner's work, by time taken. Sorted on save.</CardDescription>
            </div>
            {!readOnly ? (
              <Button size="sm" variant="outline" onClick={() => patchRect({ bands: [...r.bands, { maxMinutes: 0, amount: 0 }] })}>
                <Plus className="mr-1 h-4 w-4" /> Add band
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {r.bands.length === 0 ? (
            <p className="text-xs text-muted-foreground">No bands — a default set is restored on save.</p>
          ) : (
            r.bands.map((band, idx) => (
              <div key={idx} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <NumField label="Up to (minutes)" value={band.maxMinutes} disabled={readOnly}
                  onChange={(v) => patchRect({ bands: r.bands.map((x, i) => (i === idx ? { ...x, maxMinutes: v } : x)) })} />
                <NumField label="Deduction ($)" value={band.amount} disabled={readOnly}
                  onChange={(v) => patchRect({ bands: r.bands.map((x, i) => (i === idx ? { ...x, amount: v } : x)) })} />
                {!readOnly ? (
                  <Button size="icon" variant="ghost" aria-label="Remove band"
                    onClick={() => patchRect({ bands: r.bands.filter((_, i) => i !== idx) })}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                ) : null}
              </div>
            ))
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField label="Manager review over (minutes)" value={r.managerReviewOverMinutes} disabled={readOnly}
              onChange={(v) => patchRect({ managerReviewOverMinutes: v })} hint="Rework beyond this needs manager review." />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Rework deductions require approval</p>
              <p className="text-xs text-muted-foreground">A rework deduction is proposed as PENDING and a manager must approve it.</p>
            </div>
            <Switch checked={r.reworkDeductionsRequireApproval} disabled={readOnly} onCheckedChange={(v) => patchRect({ reworkDeductionsRequireApproval: v })} />
          </div>
        </CardContent>
      </Card>

      {/* Issue categories */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Issue categories</CardTitle>
              <CardDescription>Taxonomy QA picks from. Key is slugified on save; blank rows dropped.</CardDescription>
            </div>
            {!readOnly ? (
              <Button size="sm" variant="outline" onClick={() => setDraft((prev) => ({ ...prev, issueCategories: [...prev.issueCategories, { key: "", label: "" }] }))}>
                <Plus className="mr-1 h-4 w-4" /> Add category
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.issueCategories.map((cat, idx) => (
            <div key={idx} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Key</Label>
                <Input value={cat.key} placeholder="e.g. dusting" disabled={readOnly}
                  onChange={(e) => setDraft((prev) => ({ ...prev, issueCategories: prev.issueCategories.map((c, i) => (i === idx ? { ...c, key: e.target.value } : c)) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Label</Label>
                <Input value={cat.label} placeholder="e.g. Dusting" disabled={readOnly}
                  onChange={(e) => setDraft((prev) => ({ ...prev, issueCategories: prev.issueCategories.map((c, i) => (i === idx ? { ...c, label: e.target.value } : c)) }))} />
              </div>
              {!readOnly ? (
                <Button size="icon" variant="ghost" aria-label="Remove category"
                  onClick={() => setDraft((prev) => ({ ...prev, issueCategories: prev.issueCategories.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Patterns + gates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recurring patterns & job gates</CardTitle>
          <CardDescription>When the same category recurs for a cleaner/property this often within the window, it's a recurring pattern.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumField label="Same-category count" value={draft.patternSameCategoryCount} disabled={readOnly}
              onChange={(v) => setDraft((prev) => ({ ...prev, patternSameCategoryCount: v }))} />
            <NumField label="Window (days)" value={draft.patternWindowDays} disabled={readOnly}
              onChange={(v) => setDraft((prev) => ({ ...prev, patternWindowDays: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Require job-start confirmation</p>
              <p className="text-xs text-muted-foreground">Cleaners must confirm they've started before the clock runs.</p>
            </div>
            <Switch checked={draft.requireJobStartConfirmation} disabled={readOnly} onCheckedChange={(v) => setDraft((prev) => ({ ...prev, requireJobStartConfirmation: v }))} />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Self-inspection blocks submit</p>
              <p className="text-xs text-muted-foreground">A cleaner cannot submit until the self-inspection checklist is complete.</p>
            </div>
            <Switch checked={draft.selfInspectionBlocksSubmit} disabled={readOnly} onCheckedChange={(v) => setDraft((prev) => ({ ...prev, selfInspectionBlocksSubmit: v }))} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {message ? (
          <span className={message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-red-600"}>{message.text}</span>
        ) : null}
        {!readOnly ? (
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
