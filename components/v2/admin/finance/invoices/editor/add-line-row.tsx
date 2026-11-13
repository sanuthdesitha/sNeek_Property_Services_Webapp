"use client";

/**
 * The inline "add a line" row (Wave D): typing in the description offers the
 * client's unbilled finished jobs (added through "Add finished jobs", the
 * generator's own line builder) and the saved invoice items (fill the
 * description and rate). A keyboard combobox: arrows move, Enter picks,
 * Escape closes. A job without a rate is shown but cannot be picked. The list
 * sits in the flow under the input so the scrolling table never clips it.
 */
import { useId, useMemo, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { money, fmtDay } from "../invoice-model";
import type { LineDraft } from "./line-drafts";
import { matchSuggestions, type LineSuggestions, type Suggestion } from "./use-line-suggestions";

const NEW_INPUT =
  "h-11 min-w-0 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[1rem] " +
  "focus:border-[hsl(var(--e-gold))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:opacity-60 sm:h-9 sm:text-[0.8125rem]";

export type AddLineRowProps = {
  newLine: LineDraft;
  /** Text inputs (stay usable during a background autosave). */
  inputsFrozen: boolean;
  /** The Add button and picking a suggestion. */
  frozen: boolean;
  suggestions: LineSuggestions | null;
  /** The invoice's GST switch, for the saved item's GST note. */
  gstEnabled: boolean;
  onNewLine: (draft: LineDraft) => void;
  onAddLine: () => void;
  onAddJob: (jobId: string) => void;
};

/** Why a saved item's GST setting does not apply here, or null when it matches. */
export function savedItemGstNote(itemGst: boolean, gstEnabled: boolean): string | null {
  if (itemGst === gstEnabled) return null;
  return itemGst
    ? "This item is saved as charging GST, but GST is off on this invoice. The invoice's GST switch decides."
    : "This item is saved as GST-free, but GST is on for this invoice and applies to every line. The invoice's GST switch decides.";
}

function SuggestionText({ suggestion }: { suggestion: Suggestion }) {
  if (suggestion.kind === "item") {
    return (
      <>
        <span className="min-w-0 flex-1 break-words">{suggestion.item.name}</span>
        <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">Saved item · {money(suggestion.item.rate)}</span>
      </>
    );
  }
  const { job } = suggestion;
  return (
    <>
      <span className="min-w-0 flex-1 break-words">
        <span className="font-mono text-[0.75rem]">{job.jobNumber ?? "Job"}</span> {job.propertyName} · {fmtDay(job.scheduledDay)}
      </span>
      <span className={job.charge === null ? "text-[hsl(var(--e-warning))]" : "e-tnum text-[hsl(var(--e-muted-foreground))]"}>
        {job.charge === null ? "No rate: cannot add" : `Unbilled job · ${money(job.charge)}`}
      </span>
    </>
  );
}

export function AddLineRow(props: AddLineRowProps) {
  const { newLine, inputsFrozen, frozen } = props;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [gstNote, setGstNote] = useState<string | null>(null);
  const matches = useMemo(
    () => (props.suggestions ? matchSuggestions(newLine.description, props.suggestions) : []),
    [newLine.description, props.suggestions],
  );
  const showList = open && matches.length > 0;

  function pick(suggestion: Suggestion | undefined) {
    if (!suggestion || frozen) return;
    setOpen(false);
    if (suggestion.kind === "job") {
      if (suggestion.job.charge === null) return;
      props.onAddJob(suggestion.job.id);
      props.onNewLine({ ...newLine, description: "" });
      return;
    }
    const { item } = suggestion;
    props.onNewLine({ description: item.name, quantity: newLine.quantity || "1", unitPrice: item.rate.toFixed(2) });
    setGstNote(savedItemGstNote(item.gst, props.gstEnabled));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(matches[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <tr>
      <td className="px-3 py-2" />
      <td className="px-3 py-2" colSpan={2}>
        <input
          className={`${NEW_INPUT} w-full`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-label="New line description"
          placeholder="Type to add a line, or pick a job or saved item…"
          value={newLine.description}
          disabled={inputsFrozen}
          onChange={(event) => {
            props.onNewLine({ ...newLine, description: event.target.value });
            setOpen(true);
            setActive(0);
            setGstNote(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
        {showList ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Unbilled jobs and saved items"
            className="mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] py-1 shadow-lg"
          >
            {matches.map((suggestion, index) => (
              <li
                key={suggestion.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={suggestion.kind === "job" && suggestion.job.charge === null ? true : undefined}
                className={`flex cursor-pointer flex-wrap items-center gap-x-2 px-3 py-2 text-[0.8125rem] ${index === active ? "bg-[hsl(var(--e-primary-soft))]" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(suggestion)}
              >
                <SuggestionText suggestion={suggestion} />
              </li>
            ))}
          </ul>
        ) : null}
        {gstNote ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-warning))]">{gstNote}</p> : null}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          className={`${NEW_INPUT} w-[4.5rem] text-right e-tnum`}
          inputMode="decimal"
          aria-label="New line quantity"
          value={newLine.quantity}
          disabled={inputsFrozen}
          onChange={(event) => props.onNewLine({ ...newLine, quantity: event.target.value })}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <input
          className={`${NEW_INPUT} w-[6rem] text-right e-tnum`}
          inputMode="decimal"
          aria-label="New line rate"
          placeholder="0.00"
          value={newLine.unitPrice}
          disabled={inputsFrozen}
          onChange={(event) => props.onNewLine({ ...newLine, unitPrice: event.target.value })}
        />
      </td>
      <td className="px-3 py-2" />
      <td className="px-1 py-2 text-right">
        <EButton type="button" size="sm" variant="outline" disabled={frozen} onClick={props.onAddLine}>
          Add
        </EButton>
      </td>
    </tr>
  );
}
