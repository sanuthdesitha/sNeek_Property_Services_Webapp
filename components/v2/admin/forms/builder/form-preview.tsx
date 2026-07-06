"use client";

/**
 * ESTATE form builder — read-only live preview. Renders the schema roughly as
 * the cleaner sees it: sections, fields, inputs (disabled), respecting the
 * FormTheme (accent / header colour / fonts / dividers) and flagging fields
 * that carry a show/hide rule. No answers are collected. Native Estate styling.
 */
import * as React from "react";
import { EyeOff } from "lucide-react";
import type { FormField, FormSchema } from "@/lib/forms/types";
import { getFieldTypeDef, isUploadFieldType } from "@/lib/forms/field-types";
import { flattenFieldsOneLevel } from "@/lib/forms/visibility";
import { DIVIDER_LABEL } from "./blocks";
import { EFieldIcon } from "./field-icon";

function PreviewInput({ field }: { field: FormField }) {
  const base =
    "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]";

  if (isUploadFieldType(field.type)) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-3 py-6 text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
        <EFieldIcon name={getFieldTypeDef(field.type)?.icon} className="size-4" />
        {field.mediaMode === "both"
          ? "Capture photo or video"
          : field.type === "video"
            ? "Record video"
            : field.type === "file"
              ? "Upload file"
              : `Capture photo${field.minPhotos && field.minPhotos > 1 ? ` (min ${field.minPhotos})` : ""}`}
      </div>
    );
  }

  switch (field.type) {
    case "longtext":
      return <div className={`${base} h-16`}>{field.placeholder || ""}</div>;
    case "select":
    case "multiselect":
    case "radio": {
      const opts = field.options ?? [];
      if (field.type === "radio") {
        return (
          <div className="space-y-1.5">
            {(opts.length ? opts : ["Option A", "Option B"]).map((o, i) => (
              <div key={i} className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                <span className="size-3.5 rounded-full border border-[hsl(var(--e-border-strong))]" />
                {o}
              </div>
            ))}
          </div>
        );
      }
      return <div className={base}>{opts[0] ?? "Choose…"}</div>;
    }
    case "checkbox":
      return (
        <div className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <span className="size-3.5 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))]" /> {field.label}
        </div>
      );
    case "yesno":
      return (
        <div className="flex gap-2">
          {["Yes", "No", ...(field.includeNa ? ["N/A"] : [])].map((o) => (
            <span key={o} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 py-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {o}
            </span>
          ))}
        </div>
      );
    case "rating":
      return <div className="text-[hsl(var(--e-gold))]">★ ★ ★ ★ ★</div>;
    case "signature":
      return <div className={`${base} h-14 italic text-[hsl(var(--e-text-faint))]`}>Signature pad</div>;
    default:
      return <div className={base}>{field.placeholder || field.unit || ""}&nbsp;</div>;
  }
}

function FieldRow({
  field,
  accent,
  indent,
}: {
  field: FormField;
  accent?: string;
  indent?: boolean;
}) {
  // Instruction/divider blocks
  if (field.type === "instruction" && field.label === DIVIDER_LABEL) {
    return <hr className="my-3 border-[hsl(var(--e-border))]" />;
  }
  if (field.type === "instruction") {
    return (
      <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
        <p className="text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">{field.label}</p>
        {field.helpText ? <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{field.helpText}</p> : null}
      </div>
    );
  }

  const hasCondition = Boolean(field.conditional?.fieldId);

  return (
    <div className={indent ? "border-l border-[hsl(var(--e-border))] pl-3" : ""}>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
          {field.label}
          {field.required ? <span className="ml-0.5" style={{ color: accent || "hsl(var(--e-danger))" }}>*</span> : null}
        </label>
        {field.severity ? (
          <span className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
            {field.severity}
          </span>
        ) : null}
        {field.stampTag && field.stampTag !== "auto" ? (
          <span className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-gold-soft))] px-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-gold-ink))]">
            {field.stampTag}
          </span>
        ) : null}
        {hasCondition ? (
          <span className="inline-flex items-center gap-1 text-[0.625rem] text-[hsl(var(--e-text-faint))]">
            <EyeOff className="size-3" /> conditional
          </span>
        ) : null}
      </div>
      {field.helpText ? <p className="mb-1.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{field.helpText}</p> : null}
      <PreviewInput field={field} />
    </div>
  );
}

export function FormPreview({ schema, name }: { schema: FormSchema; name: string }) {
  const theme = schema.theme ?? {};
  const accent = theme.accentColor;
  const headingStyle: React.CSSProperties = {
    color: theme.headerColor || undefined,
    fontFamily: theme.headingFont || undefined,
  };

  return (
    <div
      className="mx-auto max-w-2xl rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6"
      style={{ fontFamily: theme.bodyFont || undefined }}
    >
      <p className="mb-4 text-center text-[1.125rem] font-semibold text-[hsl(var(--e-foreground))]" style={headingStyle}>
        {name || "Untitled form"}
      </p>

      {schema.sections.length === 0 ? (
        <p className="py-8 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No sections yet.</p>
      ) : (
        <div className="space-y-7">
          {schema.sections.map((section) => {
            const rows = flattenFieldsOneLevel(section.fields) as Array<FormField & { _isChild?: boolean }>;
            return (
              <div key={section.id} className="space-y-3">
                <div>
                  <h3 className="text-[1rem] font-semibold text-[hsl(var(--e-foreground))]" style={headingStyle}>
                    {section.title}
                  </h3>
                  {section.description ? (
                    <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{section.description}</p>
                  ) : null}
                  {theme.showDividers ? <hr className="mt-2 border-[hsl(var(--e-border))]" /> : null}
                </div>
                {rows.length === 0 ? (
                  <p className="text-[0.75rem] italic text-[hsl(var(--e-text-faint))]">No fields.</p>
                ) : (
                  rows.map((f) => <FieldRow key={f.id} field={f} accent={accent} indent={f._isChild} />)
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
