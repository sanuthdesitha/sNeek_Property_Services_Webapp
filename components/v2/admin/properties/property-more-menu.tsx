"use client";

/**
 * The property "more" menu used by the list row, the side panel and the
 * property page: New job here, Copy as new property, Edit form fields and
 * Archive (deactivate). Archive keeps its PIN-or-password check
 * (DELETE /api/admin/properties/:id, `properties.archive`); jobs and history
 * are kept.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { copyPropertyHref, newJobHref, propertyHref, PROPERTY_FORM_SETTINGS_HREF } from "@/lib/properties/links";

export function ArchivePropertyDialog({
  propertyId,
  propertyName,
  open,
  onClose,
  onArchived,
}: {
  propertyId: string;
  propertyName: string;
  open: boolean;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function archive(credentials?: { pin?: string; password?: string }) {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast({ title: "Deactivate failed", description: body.error ?? "Could not deactivate property.", variant: "destructive" });
        return;
      }
      toast({ title: "Property deactivated" });
      onArchived();
    } finally {
      setBusy(false);
    }
  }

  return (
    <EConfirmModal
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={`Deactivate ${propertyName}`}
      description="This deactivates the property so it no longer appears in the active portfolio. Jobs and history are retained."
      confirmLabel="Deactivate"
      requireSecurity
      loading={busy}
      onConfirm={archive}
    />
  );
}

export function PropertyMoreMenu({
  propertyId,
  propertyName,
  onArchived,
  includeOpen = false,
  includeNewJob = true,
  trigger,
}: {
  propertyId: string;
  propertyName: string;
  onArchived: () => void;
  includeOpen?: boolean;
  includeNewJob?: boolean;
  trigger?: React.ReactNode;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const items: ERowMenuItem[] = [
    ...(includeOpen ? [{ key: "open", label: "Open property", href: propertyHref(propertyId) }] : []),
    ...(includeNewJob ? [{ key: "new-job", label: "New job here", href: newJobHref(propertyId) }] : []),
    { key: "copy", label: "Copy as new property", href: copyPropertyHref(propertyId) },
    { key: "form-fields", label: "Edit form fields", href: PROPERTY_FORM_SETTINGS_HREF },
    { key: "archive", label: "Deactivate…", danger: true, separated: true, onSelect: () => setArchiveOpen(true) },
  ];
  return (
    <>
      <ERowMenu label={`More for ${propertyName}`} items={items} trigger={trigger} />
      <ArchivePropertyDialog
        propertyId={propertyId}
        propertyName={propertyName}
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onArchived={() => {
          setArchiveOpen(false);
          onArchived();
        }}
      />
    </>
  );
}
