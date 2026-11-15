"use client";

import * as React from "react";
import { inlineKey } from "@/lib/email-design/inline";
import type { Inline, InlineSegment } from "@/lib/email-design/types";

/**
 * Words with value chips. Values are whole, non-editable chips (move or
 * delete them as one); typed "{{" or "<" is plain text; pasting inserts plain
 * text only. There is no HTML mode: the field emits segments, never markup.
 * Bold is the only formatting (B button or Ctrl+B) where the field allows it.
 */
export type InlineEditorHandle = { insertValue: (name: string) => void; focus: () => void };

type Props = {
  id: string;
  label: string;
  value: Inline;
  onChange: (value: Inline) => void;
  valueLabel: (name: string) => string;
  disabled?: boolean;
  multiline?: boolean;
  allowBold?: boolean;
  onFocusField?: () => void;
  describedBy?: string;
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CHIP_CLASS = "mx-0.5 inline-flex items-center rounded-full bg-[hsl(var(--e-primary)/0.12)] px-2 py-px align-baseline text-[0.8125rem] font-medium text-[hsl(var(--e-primary))] select-all";

function chipHtml(name: string, label: string, bold: boolean): string {
  return `<span contenteditable="false" data-value="${escapeHtml(name)}"${bold ? ' data-bold="1"' : ""} class="${CHIP_CLASS}${bold ? " font-bold" : ""}">${escapeHtml(label)}</span>`;
}

function toHtml(value: Inline, valueLabel: (name: string) => string): string {
  return value.map((segment) => {
    if (segment.kind === "value") return chipHtml(segment.name, valueLabel(segment.name), Boolean(segment.bold));
    const text = escapeHtml(segment.text).replace(/\n/g, "<br>");
    return segment.bold ? `<strong>${text}</strong>` : text;
  }).join("");
}

function push(out: Inline, segment: InlineSegment): void {
  const last = out[out.length - 1];
  if (segment.kind === "text" && last?.kind === "text" && Boolean(last.bold) === Boolean(segment.bold)) {
    last.text += segment.text;
    return;
  }
  if (segment.kind === "text" && !segment.text) return;
  out.push(segment);
}

/** The field's DOM → segments (chips, text, bold, line breaks). */
function fromDom(root: HTMLElement): Inline {
  const out: Inline = [];
  const walk = (node: Node, bold: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/ /g, " ").replace(/​/g, "");
      push(out, bold ? { kind: "text", text, bold: true } : { kind: "text", text });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const name = node.dataset.value;
    if (name) {
      push(out, bold || node.dataset.bold === "1" ? { kind: "value", name, bold: true } : { kind: "value", name });
      return;
    }
    if (node.tagName === "BR") {
      push(out, { kind: "text", text: "\n", ...(bold ? { bold: true } : {}) });
      return;
    }
    const isBold = bold || node.tagName === "B" || node.tagName === "STRONG" || Number(node.style.fontWeight) >= 600;
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && out.length) push(out, { kind: "text", text: "\n" });
    node.childNodes.forEach((child) => walk(child, isBold));
  };
  root.childNodes.forEach((child) => walk(child, false));
  return out.map((segment) => (segment.kind === "text" && !segment.bold ? { kind: "text", text: segment.text } : segment)) as Inline;
}

export const InlineEditor = React.forwardRef<InlineEditorHandle, Props>(function InlineEditor(
  { id, label, value, onChange, valueLabel, disabled = false, multiline = false, allowBold = false, onFocusField, describedBy },
  ref,
) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const lastEmitted = React.useRef<string>("");
  const savedRange = React.useRef<Range | null>(null);

  // Render from props only when the value changed outside this field (load, undo, reset), never while typing.
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const key = inlineKey(value);
    if (key === lastEmitted.current && root.innerHTML !== "") return;
    root.innerHTML = toHtml(value, valueLabel);
    lastEmitted.current = key;
  }, [value, valueLabel]);

  const emit = React.useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = fromDom(root);
    lastEmitted.current = inlineKey(next);
    onChange(next);
  }, [onChange]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount && rootRef.current?.contains(selection.anchorNode)) savedRange.current = selection.getRangeAt(0).cloneRange();
  };

  React.useImperativeHandle(ref, () => ({
    focus: () => rootRef.current?.focus(),
    insertValue: (name: string) => {
      const root = rootRef.current;
      if (!root || disabled) return;
      root.focus();
      const selection = window.getSelection();
      const range = savedRange.current && root.contains(savedRange.current.startContainer) ? savedRange.current : null;
      const holder = document.createElement("span");
      holder.innerHTML = chipHtml(name, valueLabel(name), false);
      const node = holder.firstChild as HTMLElement;
      const space = document.createTextNode(" ");
      if (range) {
        range.deleteContents();
        range.insertNode(space);
        range.insertNode(node);
      } else {
        root.appendChild(node);
        root.appendChild(space);
      }
      const after = document.createRange();
      after.setStartAfter(space);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      savedRange.current = after.cloneRange();
      emit();
    },
  }), [disabled, emit, valueLabel]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !multiline) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && multiline) {
      event.preventDefault();
      document.execCommand("insertLineBreak");
      emit();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
      event.preventDefault();
      if (allowBold) {
        document.execCommand("bold");
        emit();
      }
    }
    if ((event.ctrlKey || event.metaKey) && ["i", "u"].includes(event.key.toLowerCase())) event.preventDefault();
  }

  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, multiline ? text : text.replace(/\s*\n\s*/g, " "));
    emit();
  }

  return (
    <div className="flex min-w-0 items-start gap-1">
      <div
        id={id}
        ref={rootRef}
        role="textbox"
        aria-label={label}
        aria-multiline={multiline}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={(event) => event.preventDefault()}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={rememberSelection}
        onFocus={onFocusField}
        className={`min-h-[44px] min-w-0 flex-1 whitespace-pre-wrap break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2.5 text-base leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))] sm:text-sm ${disabled ? "cursor-not-allowed opacity-70" : ""}`}
      />
      {allowBold && !disabled ? (
        <button
          type="button"
          aria-label={`Bold (${label})`}
          title="Bold (Ctrl+B)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { rootRef.current?.focus(); document.execCommand("bold"); emit(); }}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
        >
          B
        </button>
      ) : null}
    </div>
  );
});
