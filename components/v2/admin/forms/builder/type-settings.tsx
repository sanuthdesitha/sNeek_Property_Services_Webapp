"use client";

/**
 * Type-specific question settings (choices, yes/no behaviour, range and
 * units, capture settings), moved out of the properties panel unchanged.
 */
import * as React from "react";
import type { FormField } from "@/lib/forms/types";
import { getFieldTypeDef } from "@/lib/forms/field-types";
import { EField, EInput, ETextarea, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { PanelSection as Section } from "./panel-section";
import { StockCountSettings, TableSettings } from "./structured-type-settings";
import { EffectSettings } from "./effect-settings";

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function TypeSettings({ field, onUpdate }: { field: FormField; onUpdate: (field: FormField) => void }) {
  const def = getFieldTypeDef(field.type);
  const hasOptions = Boolean(def?.hasOptions);
  const hasRange = Boolean(def?.hasRange);
  const isUpload = Boolean(def?.isUpload);
  return (
    <>
        {field.type === "table" ? <TableSettings field={field} onUpdate={onUpdate} /> : null}
        {field.type === "stock_count" ? <StockCountSettings field={field} onUpdate={onUpdate} /> : null}
        <EffectSettings field={field} onUpdate={onUpdate} />
        {/* Choices */}
        {hasOptions && (
          <Section title="Choices">
            <EField label="Options (one per line)">
              <ETextarea
                rows={4}
                value={(field.options ?? []).join("\n")}
                onChange={(e) =>
                  onUpdate({
                    ...field,
                    options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </EField>
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Allow &ldquo;Other&rdquo; (free text)</span>
              <ESwitch checked={Boolean(field.allowOther)} onCheckedChange={(v) => onUpdate({ ...field, allowOther: v || undefined })} />
            </div>
            {field.type === "select" && (
              <div className="flex items-center justify-between">
                <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Searchable</span>
                <ESwitch checked={Boolean(field.searchable)} onCheckedChange={(v) => onUpdate({ ...field, searchable: v || undefined })} />
              </div>
            )}
          </Section>
        )}

        {/* Yes/No */}
        {field.type === "yesno" && (
          <Section title="Yes / No behaviour">
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Include &ldquo;N/A&rdquo; option</span>
              <ESwitch checked={Boolean(field.includeNa)} onCheckedChange={(v) => onUpdate({ ...field, includeNa: v || undefined })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[0.8125rem] text-[hsl(var(--e-foreground))]">Require details when &ldquo;No&rdquo;</span>
              <ESwitch checked={Boolean(field.detailsWhenNo)} onCheckedChange={(v) => onUpdate({ ...field, detailsWhenNo: v || undefined })} />
            </div>
          </Section>
        )}

        {/* Range */}
        {hasRange && (
          <Section title="Range & units">
            <div className="grid grid-cols-3 gap-2">
              <EField label="Min">
                <EInput type="number" value={field.min ?? ""} onChange={(e) => onUpdate({ ...field, min: num(e.target.value) })} />
              </EField>
              <EField label="Max">
                <EInput type="number" value={field.max ?? ""} onChange={(e) => onUpdate({ ...field, max: num(e.target.value) })} />
              </EField>
              <EField label="Step">
                <EInput type="number" value={field.step ?? ""} onChange={(e) => onUpdate({ ...field, step: num(e.target.value) })} />
              </EField>
            </div>
            <EField label="Unit label (optional)">
              <EInput
                value={field.unit ?? ""}
                onChange={(e) => onUpdate({ ...field, unit: e.target.value || undefined })}
                placeholder="e.g. min, kg, rooms"
              />
            </EField>
          </Section>
        )}

        {/* Capture settings */}
        {isUpload && (
          <Section title="Capture settings">
            {(field.type === "photo" || field.type === "video") && (
              <EField label="Capture type" hint="What the cleaner can capture for this field.">
                <ESelect
                  value={field.mediaMode === "both" ? "both" : field.type === "video" ? "video" : "photo"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "both") onUpdate({ ...field, type: "photo", mediaMode: "both" });
                    else if (v === "video") onUpdate({ ...field, type: "video", mediaMode: undefined });
                    else onUpdate({ ...field, type: "photo", mediaMode: undefined });
                  }}
                >
                  <option value="photo">Photo</option>
                  <option value="video">Video</option>
                  <option value="both">Photo or Video</option>
                </ESelect>
              </EField>
            )}

            <EField label="Evidence stamp tag" hint="Burned into the top-left chip of every photo. Auto guesses from wording.">
              <ESelect
                value={field.stampTag && field.stampTag.trim() ? field.stampTag : "auto"}
                onChange={(e) => onUpdate({ ...field, stampTag: e.target.value === "auto" ? undefined : e.target.value })}
              >
                <option value="auto">Auto (from wording)</option>
                <option value="before">Before</option>
                <option value="after">After</option>
                <option value="damage">Damage</option>
              </ESelect>
            </EField>

            <div className="grid grid-cols-2 gap-2">
              {field.type !== "video" && (
                <EField label="Min files">
                  <EInput
                    type="number"
                    min={0}
                    value={field.minPhotos ?? 0}
                    onChange={(e) => onUpdate({ ...field, minPhotos: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                  />
                </EField>
              )}
              <EField label="Max files">
                <EInput type="number" min={0} value={field.maxFiles ?? ""} onChange={(e) => onUpdate({ ...field, maxFiles: num(e.target.value) })} />
              </EField>
              {/* No "Max duration" control: nothing in the capture path enforces
                  a video length, so the builder no longer promises one. */}
            </div>
          </Section>
        )}
    </>
  );
}
