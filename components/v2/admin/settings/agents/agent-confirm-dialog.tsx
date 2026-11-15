"use client";

/**
 * Every agent change asks for the administrator's own PIN in the shared tier C
 * dialog (EConfirmDialog tier "sensitive"): create, rotate, change write
 * packs, revoke, pause all and resume. The password alone confirms while the
 * administrator has no PIN, exactly as the shared field handles it. A refused
 * attempt keeps the dialog open with the server's message; the shared dialog
 * clears only the credential.
 */
import * as React from "react";
import { EConfirmDialog, type ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import type { AgentWriteScopeKey } from "@/lib/agents/write-scopes";
import { createSummary, type PendingChange } from "./agent-model";
import { WritePackFields } from "./agent-scope-fields";
import { ExpiryChoice } from "./new-agent-form";

type DialogCopy = { title: string; description: string; confirmLabel: string };

function dialogCopy(pending: PendingChange): DialogCopy {
  switch (pending.kind) {
    case "create":
      return { title: `Create ${pending.draft.name.trim()}?`, description: createSummary(pending.draft), confirmLabel: "Create agent" };
    case "rotate":
      return { title: `Rotate the token of ${pending.agent.name}?`, description: "The current token stops working now. The new token is shown once after this.", confirmLabel: "Rotate token" };
    case "write-areas":
      return { title: `Change what ${pending.agent.name} may ask?`, description: "Waiting requests are checked again when someone approves them.", confirmLabel: "Save what it may ask" };
    case "revoke":
      return { title: `Revoke ${pending.agent.name}?`, description: "Its token stops working now and it cannot be restored.", confirmLabel: "Revoke agent" };
    case "pause":
      return pending.paused
        ? { title: "Pause every agent now?", description: "Every agent call is refused, no request can be made and waiting requests cannot be approved until you resume.", confirmLabel: "Pause agents" }
        : { title: "Let agents connect again?", description: "Agents with a valid token can read within their access and ask for the changes their write packs allow.", confirmLabel: "Resume agents" };
  }
}

type AgentConfirmDialogProps = {
  pending: PendingChange | null;
  grantableWrite: AgentWriteScopeKey[];
  busy: boolean;
  error: string;
  onChange: (next: PendingChange) => void;
  onClose: () => void;
  onConfirm: (result: ConfirmResult) => Promise<void>;
};

export function AgentConfirmDialog({ pending, grantableWrite, busy, error, onChange, onClose, onConfirm }: AgentConfirmDialogProps) {
  // Keep the last change while the dialog animates closed.
  const last = React.useRef<PendingChange | null>(pending);
  if (pending) last.current = pending;
  const shown = pending ?? last.current;
  if (!shown) return null;
  const copy = dialogCopy(shown);

  const lead = shown.kind === "rotate" && pending?.kind === "rotate" ? (
    <ExpiryChoice name="rotate-expiry" label="New token expires after" value={pending.expiresInDays} disabled={busy} onChange={(expiresInDays) => onChange({ ...pending, expiresInDays })} />
  ) : null;

  const fields = shown.kind === "write-areas" && pending?.kind === "write-areas" ? (
    <fieldset disabled={busy} className="min-w-0">
      <legend className="sr-only">What it may ask to change</legend>
      <WritePackFields legend={`What ${pending.agent.name} may ask to change`} value={pending.writeAreas} grantable={grantableWrite} onChange={(writeAreas) => onChange({ ...pending, writeAreas })} />
    </fieldset>
  ) : null;

  return (
    <EConfirmDialog
      open={pending !== null}
      onClose={onClose}
      tier="sensitive"
      title={copy.title}
      description={copy.description}
      lead={lead}
      confirmLabel={copy.confirmLabel}
      busy={busy}
      error={error || undefined}
      onConfirm={onConfirm}
    >
      {fields}
    </EConfirmDialog>
  );
}
