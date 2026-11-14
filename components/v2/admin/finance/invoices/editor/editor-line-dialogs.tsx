"use client";

/**
 * Per-line confirmations: removing a line and choosing the property a manual
 * line groups under.
 *
 * Removing a line (board "Confirmations and deletes", owner default
 * 2026-11-14, pending owner confirmation):
 *   - DRAFT invoice: tier B, one red button, no PIN. The editor offers Undo for
 *     a plain manual line (it is added again with the same text, quantity and
 *     price); a job, discount, shopping or case line is not re-created by Undo.
 *   - Past DRAFT: tier C as before, the own PIN sent with the removal and
 *     verified by the invoice route on the server.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import type { ClientInvoiceEditorData, EditorLine } from "@/lib/billing/client-invoice-editor-types";

export type Credentials = { pin?: string; password?: string; newPin?: string };

/** A line Undo can put back exactly: a manual charge with no job, discount, shopping, case or grouping link. */
export function lineCanBeRestored(line: EditorLine): boolean {
  return !line.job && !line.discount && !line.shoppingLocked && !line.fromCase && !line.propertyId && !line.note;
}

export function RemoveLineDialog({
  line,
  draft,
  busy,
  onClose,
  onConfirm,
}: {
  line: EditorLine | null;
  /** True while the invoice is a DRAFT: no PIN (the server checks the status again). */
  draft: boolean;
  busy: boolean;
  onClose: () => void;
  /** Sends the removal (with the credentials past DRAFT); the server checks them. */
  onConfirm: (line: EditorLine, credentials: Credentials) => void;
}) {
  function confirm(credentials?: Credentials) {
    if (!line) return;
    onConfirm(line, credentials ?? {});
  }
  const label = line?.description ? `"${line.description}"` : "This line";
  const undoable = line ? draft && lineCanBeRestored(line) : false;
  return (
    <EConfirmModal
      open={Boolean(line)}
      onClose={() => !busy && onClose()}
      title="Remove this line?"
      description={
        draft
          ? `${label} comes off this draft and the total is worked out again.${undoable ? " You get Undo for 10 seconds." : line?.job ? " Its job can be added again with Add jobs." : ""}`
          : `${label} comes off the invoice and the total is worked out again.`
      }
      confirmLabel="Remove line"
      tier={draft ? "destructive" : "sensitive"}
      loading={busy}
      onConfirm={confirm}
    />
  );
}

export function RegroupLineDialog({
  line,
  properties,
  busy,
  onClose,
  onSave,
}: {
  line: EditorLine | null;
  properties: ClientInvoiceEditorData["clientProperties"];
  busy: boolean;
  onClose: () => void;
  onSave: (line: EditorLine, propertyId: string | null) => void;
}) {
  if (!line) return null;
  return <RegroupForm key={line.id} line={line} properties={properties} busy={busy} onClose={onClose} onSave={onSave} />;
}

function RegroupForm({
  line,
  properties,
  busy,
  onClose,
  onSave,
}: {
  line: EditorLine;
  properties: ClientInvoiceEditorData["clientProperties"];
  busy: boolean;
  onClose: () => void;
  onSave: (line: EditorLine, propertyId: string | null) => void;
}) {
  const [propertyId, setPropertyId] = useState(line.propertyId ?? "");
  return (
    <EModal open onClose={() => !busy && onClose()} eyebrow="Invoice line" title="Group under a property">
      <div className="space-y-4">
        <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
          A manual charge can be filed under one of this client&rsquo;s properties on the invoice and its PDF. It does not
          change the amount.
        </p>
        <EField label="Property">
          <ESelect aria-label="Property" value={propertyId} disabled={busy} onChange={(event) => setPropertyId(event.target.value)}>
            <option value="">Other charges (no property)</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
                {property.suburb ? ` — ${property.suburb}` : ""}
              </option>
            ))}
          </ESelect>
        </EField>
        <div className="flex justify-end gap-2">
          <EButton type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </EButton>
          <EButton type="button" disabled={busy} onClick={() => onSave(line, propertyId || null)}>
            Save grouping
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
