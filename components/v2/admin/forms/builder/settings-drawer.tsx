"use client";

/**
 * Form settings (from the header's More menu): name, service type, the form
 * theme and the template-level stock selection — the controls the previous
 * builder had in its top bar and "Theme & settings" drawer. Every change is an
 * ordinary edit of the draft (undoable, autosaved).
 */
import * as React from "react";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { FormSchema } from "@/lib/forms/types";
import { BuilderDrawer } from "./builder-drawer";
import { InventorySettingsCard } from "./inventory-settings";
import { ThemeEditor } from "./theme-editor";
import type { BuilderDoc } from "./use-builder-document";

/* Job service types — must match the Prisma JobType enum. */
export const SERVICE_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["AIRBNB_TURNOVER", "Airbnb Turnover"],
  ["DEEP_CLEAN", "Deep Clean"],
  ["END_OF_LEASE", "End of Lease"],
  ["GENERAL_CLEAN", "General Clean"],
  ["POST_CONSTRUCTION", "Post-Construction"],
  ["PRESSURE_WASH", "Pressure Wash"],
  ["WINDOW_CLEAN", "Window Clean"],
  ["LAWN_MOWING", "Lawn Mowing"],
  ["SPECIAL_CLEAN", "Special Clean"],
  ["COMMERCIAL_RECURRING", "Commercial Recurring"],
  ["CARPET_STEAM_CLEAN", "Carpet Steam Clean"],
  ["MOLD_TREATMENT", "Mold Treatment"],
  ["UPHOLSTERY_CLEANING", "Upholstery Cleaning"],
  ["TILE_GROUT_CLEANING", "Tile & Grout Cleaning"],
  ["GUTTER_CLEANING", "Gutter Cleaning"],
  ["SPRING_CLEANING", "Spring Cleaning"],
];

export function SettingsDrawer({
  open,
  onClose,
  doc,
  kind,
  disabled,
  onEdit,
}: {
  open: boolean;
  onClose: () => void;
  doc: BuilderDoc;
  kind: string;
  disabled: boolean;
  onEdit: (next: (doc: BuilderDoc) => BuilderDoc, coalesceKey?: string) => void;
}) {
  const editSchema = (next: (schema: FormSchema) => FormSchema) => onEdit((current) => ({ ...current, schema: next(current.schema) }));
  return (
    <BuilderDrawer open={open} onClose={onClose} eyebrow={`Template · ${kind}`} title="Form settings">
      <fieldset disabled={disabled} className="space-y-6">
        <div className="space-y-3">
          <EField label="Template name">
            <EInput value={doc.name} maxLength={100} onChange={(event) => onEdit((current) => ({ ...current, name: event.target.value }), "name")} />
          </EField>
          <EField label="Service type" hint="Which jobs this form is for. Takes effect when published.">
            <ESelect value={doc.serviceType} onChange={(event) => onEdit((current) => ({ ...current, serviceType: event.target.value }))}>
              {SERVICE_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </ESelect>
          </EField>
        </div>
        <div className="border-t border-[hsl(var(--e-border))] pt-5">
          <ThemeEditor theme={doc.schema.theme} onChange={(theme) => editSchema((schema) => ({ ...schema, theme }))} />
        </div>
        <div className="space-y-4 border-t border-[hsl(var(--e-border))] pt-5">
          <EEyebrow>Template settings</EEyebrow>
          <InventorySettingsCard
            config={doc.schema.inventoryConfig}
            onChange={(inventoryConfig) =>
              editSchema((schema) => {
                const next = { ...schema };
                if (inventoryConfig) next.inventoryConfig = inventoryConfig;
                else delete next.inventoryConfig;
                return next;
              })
            }
          />
          <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3">
            <p className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Laundry update: automatic</p>
            <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Airbnb turnovers only (per-property toggle in Property settings). Rework jobs never show it.
            </p>
          </div>
        </div>
      </fieldset>
    </BuilderDrawer>
  );
}
