"use client";

import { useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToggle, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

/**
 * Public site widgets. Each flag PATCHes under publicWidgets.* — the identical
 * keys v1 uses. Disabled widgets are removed from the public marketing site.
 */
export type PublicWidgetsSettings = Record<string, boolean>;

const FIELDS: Array<[string, string]> = [
  ["instantQuoteEstimator", "Instant price estimator (home page)"],
  ["availabilityChecker", "Suburb availability checker"],
  ["liveChat", "Live chat / WhatsApp button"],
  ["newsletterSignup", "Newsletter signup form"],
  ["testimonialCarousel", "Testimonial carousel"],
  ["serviceCalculator", "Service calculator widgets"],
];

export function PublicWidgetsSection({
  initial,
  readOnly,
}: {
  initial: PublicWidgetsSettings;
  readOnly: boolean;
}) {
  const [form, setForm] = useState<PublicWidgetsSettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicWidgets: form }),
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
        eyebrow="Marketing"
        title="Public site widgets"
        description="Optional widgets on the public marketing site. Disabled widgets are removed from the home page."
      />

      <ECard className="p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(([key, label]) => (
            <div
              key={key}
              className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2.5"
            >
              <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{label}</span>
              <EToggle
                checked={form?.[key] ?? true}
                onChange={(v) => setForm((p) => ({ ...p, [key]: v }))}
                disabled={readOnly}
              />
            </div>
          ))}
        </div>
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
