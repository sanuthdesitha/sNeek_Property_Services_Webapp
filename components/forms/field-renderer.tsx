"use client";

import * as React from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { FormField } from "@/lib/forms/types";
import { fieldDetailsKey } from "@/lib/forms/visibility";
import { FieldInput } from "./field-input";

export interface FieldRendererProps {
  /** Field to render. May carry the `_isChild` flag set by flattenFieldsOneLevel. */
  field: FormField & { _isChild?: boolean };
  /** All answers keyed by field id (the renderer also reads/writes `${id}_details`). */
  answers: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  className?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-destructive/10 text-destructive",
  medium: "bg-warning/15 text-foreground",
  low: "bg-muted text-muted-foreground",
};

/**
 * Renders one field: location tag + severity chips, the FieldInput control,
 * and the conditional "details required when No" note for yes/no fields.
 * Sub-fields are NOT rendered here — callers flatten them with
 * flattenFieldsOneLevel and indent entries flagged `_isChild`.
 */
export function FieldRenderer({ field, answers, onAnswer, className }: FieldRendererProps) {
  const value = answers[field.id];
  const showDetails = field.type === "yesno" && Boolean(field.detailsWhenNo) && value === false;
  const detailsKey = fieldDetailsKey(field.id);
  const detailsValue = answers[detailsKey];
  const severity = field.severity && SEVERITY_STYLES[field.severity] ? field.severity : undefined;
  const hasChips = Boolean(field.locationTag) || Boolean(severity);

  return (
    <div
      className={`space-y-2 ${field._isChild ? "ml-4 border-l-2 border-border pl-3" : ""} ${className ?? ""}`}
    >
      {hasChips ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {field.locationTag ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              <MapPin className="size-3" />
              {field.locationTag}
            </span>
          ) : null}
          {severity ? (
            <span
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ${SEVERITY_STYLES[severity]}`}
            >
              {severity === "high" ? <AlertTriangle className="size-3" /> : null}
              {severity} priority
            </span>
          ) : null}
        </div>
      ) : null}

      <FieldInput field={field} value={value} onChange={(v) => onAnswer(field.id, v)} />

      {showDetails ? (
        <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-2.5">
          <Label className="text-xs font-medium">
            Details required <span className="text-destructive">*</span>
          </Label>
          <Textarea
            rows={2}
            placeholder="Explain why the answer is No…"
            value={typeof detailsValue === "string" ? detailsValue : ""}
            onChange={(e) => onAnswer(detailsKey, e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}
