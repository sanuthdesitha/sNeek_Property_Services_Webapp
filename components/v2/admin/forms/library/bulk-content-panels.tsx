"use client";

/** "Add section to all" and "Find and replace" — both saved as drafts after a preview. */
import * as React from "react";
import { EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { BulkOperation } from "@/lib/forms/template-bulk-types";
import { BulkLabel, BulkPanelShell } from "./bulk-panel-shell";
import { useBulkRun } from "./use-bulk-run";

type PanelProps = { templateIds: string[]; onApplied: () => void };

const DRAFT_NOTE = "Saved as a new draft version of each form; nothing reaches cleaners until you publish.";

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function BulkAddSectionPanel({ templateIds, onApplied }: PanelProps) {
  const run = useBulkRun(templateIds, onApplied);
  const [title, setTitle] = React.useState("");
  const [questions, setQuestions] = React.useState("");
  const [position, setPosition] = React.useState<"start" | "end">("end");
  const ids = { t: React.useId(), q: React.useId(), p: React.useId() };
  const lines = questions.split("\n").map((line) => line.trim()).filter(Boolean);
  const operation: BulkOperation | { invalid: string } = title.trim()
    ? { type: "add-section", section: { title: title.trim(), questions: lines, position } }
    : { invalid: "Give the section a title." };

  return (
    <BulkPanelShell
      title={`Add a section to all ${plural(templateIds.length, "selected form")}`}
      operation={operation}
      run={run}
      previewLabel="Preview changes"
      saveLabel="Save as drafts"
      footnote={`${DRAFT_NOTE} Each line becomes a required tick-box question with its own new id. A form that already has a section with this title is left unchanged.`}
    >
      {() => (
        <>
          <div>
            <BulkLabel htmlFor={ids.t}>Section title</BulkLabel>
            <EInput id={ids.t} className="w-56 max-w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="min-w-0">
            <BulkLabel htmlFor={ids.q}>Questions, one per line</BulkLabel>
            <ETextarea id={ids.q} rows={3} className="w-72 max-w-full" value={questions} onChange={(e) => setQuestions(e.target.value)} />
          </div>
          <div>
            <BulkLabel htmlFor={ids.p}>Place</BulkLabel>
            <ESelect id={ids.p} className="w-40" value={position} onChange={(e) => setPosition(e.target.value === "start" ? "start" : "end")}>
              <option value="end">At the end</option>
              <option value="start">At the start</option>
            </ESelect>
          </div>
        </>
      )}
    </BulkPanelShell>
  );
}

export function BulkFindReplacePanel({ templateIds, onApplied }: PanelProps) {
  const run = useBulkRun(templateIds, onApplied);
  const [find, setFind] = React.useState("");
  const [replace, setReplace] = React.useState("");
  const [matchCase, setMatchCase] = React.useState(false);
  const ids = { f: React.useId(), r: React.useId(), c: React.useId() };
  const operation: BulkOperation | { invalid: string } = find
    ? { type: "find-replace", find, replace, matchCase }
    : { invalid: "Enter the wording to find." };

  return (
    <BulkPanelShell
      title={`Find and replace wording in ${plural(templateIds.length, "selected form")}`}
      operation={operation}
      run={run}
      previewLabel="Preview changes"
      saveLabel="Save as drafts"
      footnote={`${DRAFT_NOTE} Only section titles, descriptions, question labels, help text and options change — never question ids. An option used by a condition is not renamed; that form is left unchanged.`}
    >
      {() => (
        <>
          <div>
            <BulkLabel htmlFor={ids.f}>Find</BulkLabel>
            <EInput id={ids.f} className="w-52 max-w-full" value={find} onChange={(e) => setFind(e.target.value)} />
          </div>
          <div>
            <BulkLabel htmlFor={ids.r}>Replace with</BulkLabel>
            <EInput id={ids.r} className="w-52 max-w-full" value={replace} onChange={(e) => setReplace(e.target.value)} />
          </div>
          <label htmlFor={ids.c} className="inline-flex h-10 items-center gap-2 text-[0.8125rem]">
            <input id={ids.c} type="checkbox" className="h-[15px] w-[15px] accent-[hsl(var(--e-primary))]" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
            Match case
          </label>
        </>
      )}
    </BulkPanelShell>
  );
}
