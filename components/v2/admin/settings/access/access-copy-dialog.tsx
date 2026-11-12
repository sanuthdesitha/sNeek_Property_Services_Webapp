"use client";

import { useState } from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { isAdminPerson, personSummaryLine, type AccessPerson } from "@/lib/rbac/access-screen-types";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";
import { displayName } from "./access-labels";

/**
 * "Copy access from…": pick another office person; their preset, levels,
 * switches and sensitive grants fill the target's draft. Administrator
 * capabilities are not copied. Nothing applies until saved.
 */
export function AccessCopyDialog({
  open,
  target,
  people,
  draft,
  onClose,
  onCopy,
}: {
  open: boolean;
  target: AccessPerson | null;
  people: AccessPerson[];
  draft: OpsPolicy;
  onClose: () => void;
  onCopy: (fromId: string) => void;
}) {
  const [fromId, setFromId] = useState("");
  const sources = people.filter((person) => !isAdminPerson(person) && person.id !== target?.id);
  return (
    <EActionDialog
      open={open && target !== null}
      title={target ? `Copy access to ${displayName(target)}` : "Copy access"}
      eyebrow="Access and permissions"
      description="Fills the list with another person's access. Administrator capabilities are not copied. Nothing applies until you review and save."
      onClose={onClose}
      footer={
        <>
          <EButton variant="outline" onClick={onClose}>Cancel</EButton>
          <EButton disabled={!fromId} onClick={() => { onCopy(fromId); setFromId(""); }}>Copy access</EButton>
        </>
      }
    >
      {sources.length === 0 ? (
        <p>There is nobody else with office access to copy from.</p>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Copy from</legend>
          {sources.map((person) => (
            <label key={person.id} className="flex min-h-11 items-center gap-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-1.5">
              <input type="radio" name="copy-access-from" value={person.id} checked={fromId === person.id} onChange={() => setFromId(person.id)} />
              <span>
                <b className="block">{displayName(person)}</b>
                <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{personSummaryLine(draft, person)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </EActionDialog>
  );
}
