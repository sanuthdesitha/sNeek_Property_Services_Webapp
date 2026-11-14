"use client";

import * as React from "react";
import { CALLOUT_TONES, CALLOUT_WORD, type CalloutTone, type EmailBlock, type EmailDesignDefinition, type Inline } from "@/lib/email-design/types";
import { InlineEditor, type InlineEditorHandle } from "./inline-editor";

type Props = {
  block: EmailBlock;
  definition: EmailDesignDefinition;
  disabled: boolean;
  valueLabel: (name: string) => string;
  onChange: (block: EmailBlock) => void;
  /** Tells the editor which field "Insert value" should go to. */
  onFocusField: (handle: InlineEditorHandle | null) => void;
};

const fieldLabel = "text-sm font-medium";

/** One block's own fields. Values arrive only as chips; links and filled content come from the type. */
export function BlockFields({ block, definition, disabled, valueLabel, onChange, onFocusField }: Props) {
  const fixed = disabled || block.lock === "fixed";
  const refs = React.useRef<Record<string, InlineEditorHandle | null>>({});
  const baseId = React.useId();
  const field = (key: string, label: string, value: Inline, set: (value: Inline) => void, options: { multiline?: boolean; bold?: boolean } = {}) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={`${baseId}-${key}`} className={fieldLabel}>{label}</label>
      <InlineEditor
        ref={(handle) => { refs.current[key] = handle; }}
        id={`${baseId}-${key}`}
        label={label}
        value={value}
        onChange={set}
        valueLabel={valueLabel}
        disabled={fixed}
        multiline={options.multiline}
        allowBold={options.bold}
        onFocusField={() => onFocusField(refs.current[key] ?? null)}
      />
    </div>
  );

  switch (block.type) {
    case "heading":
      return field("text", "Heading", block.text, (text) => onChange({ ...block, text }));
    case "paragraph":
      return field("text", "Paragraph (bold allowed)", block.text, (text) => onChange({ ...block, text }), { multiline: true, bold: true });
    case "note":
      return field("text", "Secondary note (up to 200 characters)", block.text, (text) => onChange({ ...block, text }), { multiline: true, bold: true });
    case "callout":
      return (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-1" disabled={fixed}>
            <legend className={fieldLabel}>Tone (the word is always shown)</legend>
            <div className="flex flex-wrap gap-2">
              {CALLOUT_TONES.map((tone: CalloutTone) => (
                <label key={tone} className="inline-flex min-h-[44px] items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 text-sm">
                  <input type="radio" name={`${baseId}-tone`} checked={block.tone === tone} onChange={() => onChange({ ...block, tone })} />
                  {CALLOUT_WORD[tone]}
                </label>
              ))}
            </div>
          </fieldset>
          {field("text", "Callout text", block.text, (text) => onChange({ ...block, text }), { multiline: true, bold: true })}
        </div>
      );
    case "details":
      return (
        <div className="flex flex-col gap-3">
          {block.rows.map((row, index) => (
            <div key={row.id} className="grid min-w-0 grid-cols-1 gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={`${baseId}-label-${row.id}`} className={fieldLabel}>Row {index + 1} label</label>
                <input
                  id={`${baseId}-label-${row.id}`}
                  value={row.label}
                  maxLength={60}
                  disabled={fixed}
                  onChange={(event) => onChange({ ...block, rows: block.rows.map((item) => (item.id === row.id ? { ...item, label: event.target.value } : item)) })}
                  className="min-h-[44px] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-sm"
                />
              </div>
              {field(`row-${row.id}`, `Row ${index + 1} value`, row.value, (value) => onChange({ ...block, rows: block.rows.map((item) => (item.id === row.id ? { ...item, value } : item)) }))}
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={fixed || block.lock === "required"}
                  onClick={() => onChange({ ...block, rows: block.rows.filter((item) => item.id !== row.id) })}
                  className="min-h-[44px] rounded-[var(--e-radius)] px-3 text-sm underline disabled:opacity-50"
                >
                  Remove row
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Empty values hide their row; they never show 0 or a blank.</p>
          {!fixed && block.rows.length < 12 ? (
            <button
              type="button"
              onClick={() => onChange({ ...block, rows: [...block.rows, { id: `r${Date.now().toString(36)}`, label: "", value: [] }] })}
              className="min-h-[44px] self-start rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 text-sm"
            >
              + Add row
            </button>
          ) : null}
        </div>
      );
    case "button": {
      const urls = definition.variables.filter((variable) => variable.format === "url");
      return (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${baseId}-label`} className={fieldLabel}>Button label (a verb, up to 24 characters)</label>
            <input id={`${baseId}-label`} value={block.label} maxLength={40} disabled={fixed} onChange={(event) => onChange({ ...block, label: event.target.value })} className="min-h-[44px] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-sm" />
            {block.labelValue ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">When the sender gives its own label (for example “View invoice”), that label is used.</p> : null}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${baseId}-link`} className={fieldLabel}>Link (set by the type)</label>
            <select id={`${baseId}-link`} value={block.link} disabled={fixed || urls.length < 2} onChange={(event) => onChange({ ...block, link: event.target.value })} className="min-h-[44px] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-sm">
              {urls.map((variable) => <option key={variable.name} value={variable.name}>{variable.label}</option>)}
            </select>
          </div>
        </div>
      );
    }
    case "signature":
      return (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {field("name", "Name", block.name, (name) => onChange({ ...block, name }))}
          {field("role", "Role", block.role, (role) => onChange({ ...block, role }))}
        </div>
      );
    case "photos":
      return field("caption", `Caption under the photos (${valueLabel(block.source)})`, block.caption, (caption) => onChange({ ...block, caption }));
    case "lineItems":
      return <p className="text-sm">Filled by the system from {valueLabel(block.source)}. It can be shown or removed, not edited.</p>;
    case "code":
      return <p className="text-sm">The code, large and fixed. Security emails only.</p>;
    case "divider":
      return <p className="text-sm">A thin line between topics. Spacing is automatic.</p>;
  }
}
