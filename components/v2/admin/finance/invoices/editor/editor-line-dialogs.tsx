"use client";

/**
 * Per-line confirmations: removing a line (PIN or password, verified by the
 * security endpoint first, exactly as the old editor did) and choosing the
 * property a manual line groups under.
 */
import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EModal, ESelect, verifyAdminSecurity } from "@/components/v2/admin/estate-kit";
import type { ClientInvoiceEditorData, EditorLine } from "@/lib/billing/client-invoice-editor-types";

type Credentials = { pin?: string; password?: string };

export function RemoveLineDialog({
  line,
  busy,
  onClose,
  onVerified,
  onRefused,
}: {
  line: EditorLine | null;
  busy: boolean;
  onClose: () => void;
  onVerified: (line: EditorLine) => void;
  onRefused: (message: string) => void;
}) {
  async function confirm(credentials?: Credentials) {
    if (!line) return;
    try {
      // The invoice route takes no security payload of its own.
      await verifyAdminSecurity(credentials);
    } catch (error) {
      onRefused(error instanceof Error && error.message ? error.message : "Your PIN or password could not be verified.");
      return;
    }
    onVerified(line);
  }
  return (
    <EConfirmModal
      open={Boolean(line)}
      onClose={() => !busy && onClose()}
      title="Remove this invoice line"
      description="The charge comes off the invoice and the total is rewritten. Enter your PIN or password to continue."
      confirmLabel="Remove line"
      requireSecurity
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
