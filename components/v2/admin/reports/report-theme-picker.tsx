"use client";

/**
 * Theme picker for the PDFs manager: sets the theme used by "Regenerate"
 * (row and bulk) and links to the theme manager. Unchanged in function from
 * the original manager's modal.
 */
import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { DEFAULT_THEME_ID, type ThemeOption } from "./report-types";

const DEFAULT_THEME: ThemeOption = { id: DEFAULT_THEME_ID, name: "Default theme", kind: "system", isDefault: false, primaryColorHsl: null, accentColorHsl: null };

export function ReportThemePicker({
  open,
  themes,
  selectedId,
  onClose,
  onSelect,
}: {
  open: boolean;
  themes: ThemeOption[];
  selectedId: string;
  onClose: () => void;
  onSelect: (theme: ThemeOption) => void;
}) {
  return (
    <EModal open={open} onClose={onClose} eyebrow="Reports" title="Report theme" wide>
      <div className="space-y-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Choose the theme applied when you regenerate a report. Selecting one here sets it for the &quot;Regenerate&quot;
          action on every row and for bulk regeneration.
        </p>
        <div className="space-y-2">
          {[DEFAULT_THEME, ...themes].map((theme) => {
            const selected = selectedId === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(theme)}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-[var(--e-radius)] border px-4 py-3 text-left transition-colors " +
                  (selected
                    ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                    : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]")
                }
              >
                <span className="flex items-center gap-3">
                  <span className="flex gap-1" aria-hidden>
                    <span
                      className="h-6 w-6 rounded-full border border-[hsl(var(--e-border-strong))]"
                      style={{ backgroundColor: theme.primaryColorHsl ? `hsl(${theme.primaryColorHsl})` : "hsl(var(--e-muted))" }}
                    />
                    <span
                      className="h-6 w-6 rounded-full border border-[hsl(var(--e-border-strong))]"
                      style={{ backgroundColor: theme.accentColorHsl ? `hsl(${theme.accentColorHsl})` : "hsl(var(--e-gold-soft))" }}
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">{theme.name}</span>
                    <span className="block text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {theme.kind}
                      {theme.isDefault ? " · default" : ""}
                    </span>
                  </span>
                </span>
                {selected ? <Check aria-hidden className="h-4 w-4 shrink-0 text-[hsl(var(--e-gold-ink))]" /> : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Theme authoring (colours, logo, layout) lives in the theme manager.</p>
          <EButton variant="outline" size="sm" asChild>
            <Link href="/v2/admin/reports/themes">Manage themes</Link>
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
