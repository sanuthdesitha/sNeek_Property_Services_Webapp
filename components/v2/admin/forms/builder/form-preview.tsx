"use client";

/**
 * ESTATE form builder — live preview. This is the admin's only chance to see a
 * template the way a cleaner will, so it is INTERACTIVE rather than a static
 * mock: every field type renders its real control, answers are held in local
 * state (never saved), and show/hide rules are evaluated with the SAME
 * lib/forms/visibility engine the cleaner app and the submit route use. Tapping
 * "Yes" on a trigger question therefore reveals exactly what it will reveal in
 * the field.
 *
 * A "Show hidden" toggle reveals conditional fields that are currently hidden
 * (dimmed, with their rule spelled out) so nothing authored can go unnoticed.
 * Theme (accent / heading colour / fonts / dividers) is honoured.
 */
import * as React from "react";
import { EyeOff, Star, MapPin, PenLine, QrCode } from "lucide-react";
import type { FormField, FormSchema } from "@/lib/forms/types";
import { getFieldTypeDef, isUploadFieldType } from "@/lib/forms/field-types";
import {
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  isTemplateNodeVisible,
} from "@/lib/forms/visibility";
import { cn } from "@/lib/utils";
import { DIVIDER_LABEL } from "./blocks";
import { EFieldIcon } from "./field-icon";

type Answers = Record<string, unknown>;

const INPUT =
  "w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--e-ring))]";

function Chip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={active && accent ? { backgroundColor: accent, borderColor: accent, color: "#fff" } : undefined}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-[550] transition-colors",
        active
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </button>
  );
}

/** The real control for a field type, wired to local preview answers. */
function PreviewControl({
  field,
  value,
  set,
  accent,
}: {
  field: FormField;
  value: unknown;
  set: (v: unknown) => void;
  accent?: string;
}) {
  // ── media / upload ────────────────────────────────────────────────────────
  if (isUploadFieldType(field.type)) {
    const what =
      field.mediaMode === "both"
        ? "Photo or video"
        : field.type === "video"
          ? "Video"
          : field.type === "file"
            ? "File / document"
            : "Photo";
    const rules = [
      field.minPhotos && field.minPhotos > 0 ? `min ${field.minPhotos}` : null,
      field.maxFiles ? `max ${field.maxFiles}` : null,
      // No "Ns max" line: video length is not enforced anywhere, so the preview
      // must not advertise a limit.
    ].filter(Boolean);
    return (
      <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))] px-3 py-5 text-center">
        <p className="flex items-center justify-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <EFieldIcon name={getFieldTypeDef(field.type)?.icon} className="size-4" />
          Capture / upload — {what}
        </p>
        {rules.length > 0 ? (
          <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{rules.join(" · ")}</p>
        ) : null}
      </div>
    );
  }

  const options = field.options ?? [];

  switch (field.type) {
    case "longtext":
      return (
        <textarea
          rows={3}
          className={INPUT}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "select":
      return (
        <select className={INPUT} value={String(value ?? "")} onChange={(e) => set(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {field.allowOther ? <option value="Other">Other…</option> : null}
        </select>
      );

    case "radio":
      return (
        <div className="flex flex-wrap gap-2">
          {(options.length ? options : ["Option A", "Option B"]).map((o) => (
            <Chip key={o} accent={accent} active={value === o} onClick={() => set(o)}>
              {o}
            </Chip>
          ))}
          {field.allowOther ? (
            <Chip accent={accent} active={value === "Other"} onClick={() => set("Other")}>
              Other…
            </Chip>
          ) : null}
        </div>
      );

    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      const all = options.length ? options : ["Option A", "Option B"];
      return (
        <div className="flex flex-wrap gap-2">
          {all.map((o) => {
            const on = arr.includes(o);
            return (
              <Chip
                key={o}
                accent={accent}
                active={on}
                onClick={() => set(on ? arr.filter((x) => x !== o) : [...arr, o])}
              >
                {o}
              </Chip>
            );
          })}
        </div>
      );
    }

    case "checkbox":
      return (
        <label className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
          <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} />
          {field.placeholder || "Yes"}
        </label>
      );

    case "yesno":
      return (
        <div className="flex flex-wrap gap-2">
          <Chip accent={accent} active={value === true} onClick={() => set(true)}>
            Yes
          </Chip>
          <Chip accent={accent} active={value === false} onClick={() => set(false)}>
            No
          </Chip>
          {field.includeNa ? (
            <Chip accent={accent} active={value === "na"} onClick={() => set("na")}>
              N/A
            </Chip>
          ) : null}
        </div>
      );

    case "rating": {
      const max = Math.max(1, Math.min(10, Number(field.max ?? 5) || 5));
      const current = Number(value ?? 0);
      return (
        <div className="flex gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => set(n)} aria-label={`${n} star`}>
              <Star
                className="size-5"
                style={{ color: accent || "hsl(var(--e-gold))" }}
                fill={n <= current ? "currentColor" : "none"}
              />
            </button>
          ))}
        </div>
      );
    }

    case "slider":
    case "scale": {
      const min = field.min ?? (field.type === "scale" ? 1 : 0);
      const max = field.max ?? (field.type === "scale" ? 5 : 10);
      const step = field.step ?? 1;
      const unset = value === undefined || value === null || value === "";
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={unset ? min : Number(value)}
            onChange={(e) => set(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-[hsl(var(--e-surface-sunken))]"
            style={{ accentColor: accent || "hsl(var(--e-primary))" }}
          />
          <span className="w-14 text-right text-[0.8125rem] font-[550] tabular-nums text-[hsl(var(--e-foreground))]">
            {unset ? "—" : `${Number(value)}${field.unit ? ` ${field.unit}` : ""}`}
          </span>
        </div>
      );
    }

    case "counter": {
      const min = field.min ?? 0;
      const step = field.step ?? 1;
      const unset = value === undefined || value === null || value === "";
      const current = unset ? min : Number(value);
      return (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => set(Math.max(min, current - step))}
            className="flex size-8 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]"
          >
            −
          </button>
          <span className="w-10 text-center text-[0.875rem] font-semibold tabular-nums">
            {unset ? "—" : current}
          </span>
          <button
            type="button"
            onClick={() => set(current + step)}
            className="flex size-8 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]"
          >
            +
          </button>
        </div>
      );
    }

    case "number":
    case "currency":
    case "temperature":
      return (
        <div className="flex items-center gap-2">
          {field.type === "currency" && !field.unit ? <span className="text-[0.8125rem]">$</span> : null}
          <input
            type="number"
            className={INPUT}
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            value={value === undefined || value === null ? "" : String(value)}
            onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {field.unit ? (
            <span className="shrink-0 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{field.unit}</span>
          ) : null}
        </div>
      );

    case "date":
    case "time":
    case "datetime":
      return (
        <input
          type={field.type === "datetime" ? "datetime-local" : field.type}
          className={INPUT}
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "email":
    case "phone":
      return (
        <input
          type={field.type === "email" ? "email" : "tel"}
          className={INPUT}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "signature":
      return (
        <div className="flex h-16 items-center justify-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-white text-[0.75rem] italic text-[hsl(160_8%_45%)]">
          <PenLine className="size-4" /> Sign here
        </div>
      );

    case "location":
      return (
        <span className="inline-flex items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-3 py-1.5 text-[0.8125rem]">
          <MapPin className="size-4" /> Capture GPS
        </span>
      );

    case "barcode":
      return (
        <div className="flex items-center gap-2">
          <QrCode className="size-4 text-[hsl(var(--e-text-faint))]" />
          <input
            className={INPUT}
            placeholder="Scan or type code"
            value={String(value ?? "")}
            onChange={(e) => set(e.target.value)}
          />
        </div>
      );

    default:
      return (
        <input
          className={INPUT}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
        />
      );
  }
}

/** Human-readable summary of a field/section show-hide rule. */
function describeCondition(cond: any, labelFor: (id: string) => string): string {
  if (!cond || typeof cond !== "object") return "";
  if ("propertyField" in cond) return `property ${String(cond.propertyField)} = ${String(cond.value ?? cond.equals ?? "")}`;
  const op = String(cond.operator ?? "equals");
  const raw = "value" in cond ? cond.value : cond.equals;
  const val = Array.isArray(raw) ? raw.join(", ") : raw === true ? "Yes" : raw === false ? "No" : String(raw ?? "");
  const verb: Record<string, string> = {
    equals: "is",
    notEquals: "is not",
    contains: "contains",
    notContains: "does not contain",
    oneOf: "is one of",
    gt: ">",
    lt: "<",
    answered: "is answered",
    notAnswered: "is not answered",
  };
  const head = `${labelFor(String(cond.fieldId ?? ""))} ${verb[op] ?? op}`;
  return op === "answered" || op === "notAnswered" ? head : `${head} ${val}`;
}

function FieldRow({
  field,
  answers,
  set,
  accent,
  indent,
  hidden,
  conditionText,
}: {
  field: FormField;
  answers: Answers;
  set: (id: string, v: unknown) => void;
  accent?: string;
  indent?: boolean;
  hidden?: boolean;
  conditionText?: string;
}) {
  if (field.type === "instruction" && field.label === DIVIDER_LABEL) {
    return <hr className="my-3 border-[hsl(var(--e-border))]" />;
  }

  const wrap = (children: React.ReactNode) => (
    <div
      className={cn(
        indent && "border-l border-[hsl(var(--e-border))] pl-3",
        hidden && "rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] p-2 opacity-55"
      )}
    >
      {hidden && conditionText ? (
        <p className="mb-1 inline-flex items-center gap-1 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
          <EyeOff className="size-3" /> hidden — shows when {conditionText}
        </p>
      ) : null}
      {children}
    </div>
  );

  if (field.type === "instruction") {
    return wrap(
      <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] px-3 py-2.5">
        <p className="text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">{field.label}</p>
        {field.helpText ? (
          <p className="mt-0.5 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {field.helpText}
          </p>
        ) : null}
      </div>
    );
  }

  const value = answers[field.id];
  const detailsOpen = field.type === "yesno" && field.detailsWhenNo && (value === false || value === "no");

  return wrap(
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <label className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
          {field.label}
          {field.required ? <span style={{ color: accent || "hsl(var(--e-danger))" }}> *</span> : null}
        </label>
        {field.severity ? (
          <span className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
            {field.severity}
          </span>
        ) : null}
        {field.locationTag ? (
          <span className="text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
            {field.locationTag}
          </span>
        ) : null}
        {field.stampTag && field.stampTag !== "auto" ? (
          <span className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-gold-soft))] px-1.5 text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-gold-ink))]">
            {field.stampTag}
          </span>
        ) : null}
        {!hidden && conditionText ? (
          <span className="inline-flex items-center gap-1 text-[0.625rem] text-[hsl(var(--e-text-faint))]">
            <EyeOff className="size-3" /> shown when {conditionText}
          </span>
        ) : null}
      </div>

      {field.references && field.references.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {field.references.map((ref, i) =>
            ref.kind === "image" && ref.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={ref.url}
                alt={ref.caption || "reference"}
                className="size-12 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] object-cover"
              />
            ) : (
              <span key={i} className="text-[0.6875rem] underline">
                {ref.caption || ref.kind}
              </span>
            )
          )}
        </div>
      ) : null}

      <PreviewControl field={field} value={value} set={(v) => set(field.id, v)} accent={accent} />

      {detailsOpen ? (
        <textarea rows={2} className={`${INPUT} mt-1.5`} placeholder="Add details (required)" readOnly />
      ) : null}
      {field.helpText ? (
        <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{field.helpText}</p>
      ) : null}
      {field.instructions ? (
        <details className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          <summary className="cursor-pointer select-none">How to do this</summary>
          <p className="mt-1 whitespace-pre-wrap">{field.instructions}</p>
        </details>
      ) : null}
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

  const [answers, setAnswers] = React.useState<Answers>({});
  const [showHidden, setShowHidden] = React.useState(false);
  const set = React.useCallback((id: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  // Property context for the visibility engine. `hasBalcony` is on so
  // balcony-named items don't silently vanish from the preview.
  const property = React.useMemo(() => ({ hasBalcony: true, inventoryEnabled: true }), []);

  const labelFor = React.useCallback(
    (id: string) => {
      for (const section of schema.sections) {
        for (const field of flattenFieldsOneLevel(section.fields)) {
          if (field?.id === id) return String(field.label || id);
        }
      }
      return id || "(field)";
    },
    [schema.sections]
  );

  return (
    <div
      className="mx-auto max-w-2xl rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6"
      style={{ fontFamily: theme.bodyFont || undefined }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[1.125rem] font-semibold text-[hsl(var(--e-foreground))]" style={headingStyle}>
          {name || "Untitled form"}
        </p>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1.5 text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden
          </label>
          {Object.keys(answers).length > 0 ? (
            <button
              type="button"
              onClick={() => setAnswers({})}
              className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))] underline"
            >
              Reset answers
            </button>
          ) : null}
        </div>
      </div>

      {schema.sections.length === 0 ? (
        <p className="py-8 text-center text-[0.8125rem] text-[hsl(var(--e-text-faint))]">No sections yet.</p>
      ) : (
        <div className="space-y-7">
          {schema.sections.map((section) => {
            const sectionVisible = isTemplateNodeVisible(section as any, answers, property);
            if (!sectionVisible && !showHidden) return null;
            const rows = flattenFieldsOneLevel(section.fields) as Array<FormField & { _isChild?: boolean }>;
            return (
              <div key={section.id} className={cn("space-y-3", !sectionVisible && "opacity-55")}>
                <div>
                  <h3 className="text-[1rem] font-semibold text-[hsl(var(--e-foreground))]" style={headingStyle}>
                    {section.title}
                    {!sectionVisible ? (
                      <span className="ml-2 text-[0.6875rem] font-normal text-[hsl(var(--e-text-faint))]">
                        hidden — shows when {describeCondition(section.conditional, labelFor)}
                      </span>
                    ) : null}
                  </h3>
                  {section.description ? (
                    <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{section.description}</p>
                  ) : null}
                  {theme.showDividers ? <hr className="mt-2 border-[hsl(var(--e-border))]" /> : null}
                </div>
                {rows.length === 0 ? (
                  <p className="text-[0.75rem] italic text-[hsl(var(--e-text-faint))]">No fields.</p>
                ) : (
                  rows.map((f) => {
                    const visible = isFlattenedFieldVisible(f as any, answers, property);
                    if (!visible && !showHidden) return null;
                    const cond = (f as any).conditional ?? (f as any)._parent?.conditional;
                    return (
                      <FieldRow
                        key={f.id}
                        field={f}
                        answers={answers}
                        set={set}
                        accent={accent}
                        indent={f._isChild}
                        hidden={!visible}
                        conditionText={cond ? describeCondition(cond, labelFor) : undefined}
                      />
                    );
                  })
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-center text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
        Interactive preview — answers are local and never saved. Conditions use the live rules engine.
      </p>
    </div>
  );
}
