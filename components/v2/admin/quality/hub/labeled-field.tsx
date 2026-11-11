/**
 * A form field whose label is programmatically tied to its control (the
 * label wraps it). EField in estate-kit renders a detached <label>, so the
 * hub's dialogs use this instead.
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
