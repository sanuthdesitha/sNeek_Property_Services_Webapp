"use client";

/**
 * WHAT THE OFFICE TELLS WHOEVER IS DOING THE WORK.
 *
 * `assignmentInstructions` has been on the item and rendered on the assignee's
 * phone for a while, and nothing anywhere could write it — so the column was
 * permanently null and the portal's instructions card never once appeared. The
 * reader was built and the writer was not.
 *
 * A LIST OF TYPED BLOCKS, not a set of columns. The office keeps discovering
 * new things worth saying — a gate code, where to collect a key, who to ring —
 * and every one of those as its own field is a migration plus a form input
 * nobody fills in. An admin adds as many blocks as the job needs and no more.
 *
 * ONLY THREE KINDS ARE OFFERED HERE. The reader also understands PHOTOS, but
 * there is no admin upload path for them yet, and a kind you can pick and then
 * cannot fill is worse than one that is absent — it looks broken rather than
 * unbuilt. It gets added the day the upload exists, not before.
 *
 * SAVING SENDS THE WHOLE LIST. The server round-trips it through
 * `parseInstructions`, so what is stored is exactly what the assignee will see,
 * and a block with a heading and no content is dropped rather than saved as an
 * empty card that reads on a phone as content that failed to load.
 */

import * as React from "react";
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import {
  INSTRUCTION_KIND_LABELS,
  type InstructionBlock,
  type InstructionKind,
} from "@/lib/maintenance/instructions";

/** PHOTOS is deliberately absent — see the note at the top of this file. */
const EDITABLE_KINDS: InstructionKind[] = ["TEXT", "PICKUP", "CONTACT"];

function blankBlock(kind: InstructionKind, seq: number): InstructionBlock {
  return { id: `block-${seq}`, kind, title: INSTRUCTION_KIND_LABELS[kind] };
}

export function AssignmentInstructionsEditor({
  itemId,
  initial,
}: {
  itemId: string;
  initial: InstructionBlock[];
}) {
  const [blocks, setBlocks] = React.useState<InstructionBlock[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const seq = React.useRef(initial.length);

  // Every edit rebuilds the array rather than mutating the block in place: a
  // mutated object at the same reference does not re-render, and the field
  // would appear to reject the keystroke.
  function patch(id: string, changes: Partial<InstructionBlock>) {
    setSaved(false);
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...changes } : b)));
  }

  function add(kind: InstructionKind) {
    seq.current += 1;
    setSaved(false);
    setBlocks((prev) => [...prev, blankBlock(kind, seq.current)]);
  }

  function remove(id: string) {
    setSaved(false);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    setSaved(false);
    setBlocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/maintenance/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentInstructions: blocks }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save the instructions. Please retry.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not reach the server. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle className="flex items-center justify-between gap-2 text-[1rem]">
          <span>Instructions for the assignee</span>
          <EBadge tone={blocks.length > 0 ? "primary" : "neutral"} soft>
            {blocks.length}
          </EBadge>
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3">
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Everyone assigned to this item sees these, whatever their role. Anything you leave blank
          is dropped rather than shown as an empty card.
        </p>

        {blocks.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Nothing added yet — the assignee sees no instructions card at all.
          </p>
        ) : null}

        {blocks.map((block, index) => (
          <div
            key={block.id}
            className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">
                {INSTRUCTION_KIND_LABELS[block.kind]}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded p-1 text-[hsl(var(--e-text-faint))] hover:text-[hsl(var(--e-foreground))] disabled:opacity-30"
                >
                  <GripVertical className="h-3.5 w-3.5 rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded p-1 text-[hsl(var(--e-text-faint))] hover:text-[hsl(var(--e-foreground))] disabled:opacity-30"
                >
                  <GripVertical className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Remove this instruction"
                  onClick={() => remove(block.id)}
                  className="rounded p-1 text-[hsl(var(--e-danger))] hover:opacity-80"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <EField label="Heading">
              <EInput
                value={block.title}
                maxLength={160}
                onChange={(e) => patch(block.id, { title: e.target.value })}
              />
            </EField>

            {block.kind === "TEXT" ? (
              <EField label="What they need to know">
                <ETextarea
                  value={block.body ?? ""}
                  maxLength={4000}
                  onChange={(e) => patch(block.id, { body: e.target.value })}
                />
              </EField>
            ) : null}

            {block.kind === "PICKUP" ? (
              <>
                <EField label="Address">
                  <EInput
                    value={block.address ?? ""}
                    maxLength={400}
                    onChange={(e) => patch(block.id, { address: e.target.value })}
                  />
                </EField>
                <EField label="Notes" hint="Which door, who to ask for, opening hours.">
                  <ETextarea
                    value={block.body ?? ""}
                    maxLength={4000}
                    onChange={(e) => patch(block.id, { body: e.target.value })}
                  />
                </EField>
              </>
            ) : null}

            {block.kind === "CONTACT" ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <EField label="Name">
                  <EInput
                    value={block.contactName ?? ""}
                    maxLength={160}
                    onChange={(e) => patch(block.id, { contactName: e.target.value })}
                  />
                </EField>
                <EField label="Phone">
                  <EInput
                    type="tel"
                    value={block.contactPhone ?? ""}
                    maxLength={60}
                    onChange={(e) => patch(block.id, { contactPhone: e.target.value })}
                  />
                </EField>
              </div>
            ) : null}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <ESelect
            aria-label="Add an instruction"
            value=""
            onChange={(e) => {
              if (e.target.value) add(e.target.value as InstructionKind);
            }}
            className="max-w-[12rem]"
          >
            <option value="">Add an instruction…</option>
            {EDITABLE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {INSTRUCTION_KIND_LABELS[kind]}
              </option>
            ))}
          </ESelect>
          <EButton size="sm" variant="ghost" onClick={() => add("TEXT")}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Note
          </EButton>
        </div>

        <div className="flex items-center gap-2">
          <EButton size="sm" variant="gold" disabled={busy} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save instructions
          </EButton>
          {saved ? <span className="text-[0.75rem] text-[hsl(var(--e-success))]">Saved.</span> : null}
        </div>

        {error ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
      </ECardBody>
    </ECard>
  );
}
