/**
 * A form field whose label wraps its control. Written when EField's label was
 * detached; EField now ties its label to a single control itself and the
 * Quality screens use it again. Kept only for its remaining importer
 * (`components/v2/admin/insights/period-chips.tsx`, owned by the Insights work).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { E_LABEL_CLASS } from "@/components/v2/admin/estate-kit";

export function LabeledField({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className={cn(E_LABEL_CLASS, "block")}>{label}</span>
      {children}
    </label>
  );
}
