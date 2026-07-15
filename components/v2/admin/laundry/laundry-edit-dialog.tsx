"use client";

/**
 * ESTATE laundry edit dialog — v2-native replacement for the v1 "Edit laundry
 * task" dialog (app/admin/laundry/page.tsx). Same field set, same endpoint:
 *   PATCH /api/admin/laundry/[taskId]
 * with pickup/drop-off dates, status, flag notes, skip reason code/note, admin
 * override note, drop-off price (→ dropoffCostAud / report amount), bag weight,
 * evidence photos (uploaded via /api/uploads/direct → evidencePhotoKeys) and an
 * evidence note. No dependency on components/ui/*.
 */
import * as React from "react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";
import { LAUNDRY_STATUS_OPTIONS, statusLabel, type LaundryTaskDTO } from "./laundry-shared";

function dateInputValue(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "yyyy-MM-dd");
}

function toDateOnlyIso(value: string) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Keep date-only values stable across timezones for planner/edit flows (v1 parity).
  return `${value}T00:00:00.000Z`;
}

type EditForm = {
  pickupDate: string;
  dropoffDate: string;
  status: string;
  flagNotes: string;
  skipReasonCode: string;
  skipReasonNote: string;
  adminOverrideNote: string;
  totalPrice: string;
  bagCount: string;
  evidenceNote: string;
};

export function LaundryEditDialog({
  task,
  onClose,
  onSaved,
}: {
  task: LaundryTaskDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState<EditForm>({
    pickupDate: "",
    dropoffDate: "",
    status: "PENDING",
    flagNotes: "",
    skipReasonCode: "NONE",
    skipReasonNote: "",
    adminOverrideNote: "",
    totalPrice: "",
    bagCount: "",
    evidenceNote: "",
  });
  const [files, setFiles] = React.useState<File[]>([]);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!task) return;
    setForm({
      pickupDate: dateInputValue(task.pickupDate),
      dropoffDate: dateInputValue(task.dropoffDate),
      status: task.status ?? "PENDING",
      flagNotes: task.flagNotes ?? "",
      skipReasonCode: task.skipReasonCode ?? "NONE",
      skipReasonNote: task.skipReasonNote ?? "",
      adminOverrideNote: task.adminOverrideNote ?? "",
      totalPrice: task.dropoffCostAud != null ? String(task.dropoffCostAud) : "",
      // Bag count lives on confirmation meta (not a task column) — opens blank;
      // set it only when recording a new pickup/drop-off count.
      bagCount: "",
      evidenceNote: "",
    });
    setFiles([]);
  }, [task]);

  const set = (patch: Partial<EditForm>) => setForm((prev) => ({ ...prev, ...patch }));

  async function save() {
    if (!task) return;
    if (!form.pickupDate || !form.dropoffDate) {
      toast({ title: "Pickup and drop-off dates are required.", variant: "destructive" });
      return;
    }
    const pickupDate = toDateOnlyIso(form.pickupDate);
    const dropoffDate = toDateOnlyIso(form.dropoffDate);
    if (!pickupDate || !dropoffDate) {
      toast({ title: "Invalid dates selected.", variant: "destructive" });
      return;
    }
    if (form.status === "SKIPPED_PICKUP" && form.skipReasonCode === "NONE") {
      toast({ title: "Skip reason is required.", description: "Select why this pickup is being skipped.", variant: "destructive" });
      return;
    }

    const trimmedPrice = form.totalPrice.trim();
    const parsedPrice = trimmedPrice ? Number(trimmedPrice) : null;
    if (trimmedPrice && (!Number.isFinite(parsedPrice) || (parsedPrice as number) < 0)) {
      toast({ title: "Invalid price", description: "Enter a valid drop-off price.", variant: "destructive" });
      return;
    }

    const trimmedBags = form.bagCount.trim();
    const parsedBags = trimmedBags ? Number(trimmedBags) : null;
    if (trimmedBags && (!Number.isInteger(parsedBags) || (parsedBags as number) < 1 || (parsedBags as number) > 50)) {
      toast({ title: "Invalid bag count", description: "Enter a whole number of bags (1–50).", variant: "destructive" });
      return;
    }

    setSaving(true);

    // Upload any attached evidence photos first so we can pass their keys (v1 flow).
    const evidencePhotoKeys: string[] = [];
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "laundry-confirmations");
        const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: fd });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadBody?.key) {
          throw new Error(uploadBody.error ?? "Could not upload evidence photo.");
        }
        evidencePhotoKeys.push(uploadBody.key);
      }
    } catch (error: any) {
      setSaving(false);
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload evidence.", variant: "destructive" });
      return;
    }

    const res = await fetch(`/api/admin/laundry/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pickupDate,
        dropoffDate,
        status: form.status,
        flagNotes: form.flagNotes || null,
        skipReasonCode: form.status === "SKIPPED_PICKUP" ? (form.skipReasonCode === "NONE" ? null : form.skipReasonCode) : null,
        skipReasonNote: form.skipReasonNote || null,
        adminOverrideNote: form.adminOverrideNote || null,
        ...(trimmedPrice ? { totalPrice: parsedPrice } : {}),
        ...(trimmedBags ? { bagCount: parsedBags } : {}),
        ...(evidencePhotoKeys.length ? { evidencePhotoKeys } : {}),
        ...(form.evidenceNote.trim() ? { evidenceNote: form.evidenceNote.trim() } : {}),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update task.", variant: "destructive" });
      return;
    }
    toast({ title: "Laundry task updated" });
    onSaved();
    onClose();
  }

  const propertyName = task?.property?.name ?? "Property";
  const suburb = task?.property?.suburb ?? "";

  return (
    <EModal
      open={Boolean(task)}
      onClose={onClose}
      eyebrow="Laundry task"
      title={`Edit — ${propertyName}${suburb ? `, ${suburb}` : ""}`}
      wide
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Pickup date">
            <EInput type="date" value={form.pickupDate} onChange={(e) => set({ pickupDate: e.target.value })} />
          </EField>
          <EField label="Drop-off date">
            <EInput type="date" value={form.dropoffDate} onChange={(e) => set({ dropoffDate: e.target.value })} />
          </EField>
        </div>

        <EField label="Status">
          <ESelect value={form.status} onChange={(e) => set({ status: e.target.value })}>
            {LAUNDRY_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </ESelect>
        </EField>

        <EField label="Flag notes" hint="Optional notes shown against the task.">
          <ETextarea rows={2} value={form.flagNotes} onChange={(e) => set({ flagNotes: e.target.value })} placeholder="Optional notes" />
        </EField>

        {form.status === "SKIPPED_PICKUP" ? (
          <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
            <EField label="Skip reason">
              <ESelect value={form.skipReasonCode} onChange={(e) => set({ skipReasonCode: e.target.value })}>
                <option value="NONE">Select a reason…</option>
                {LAUNDRY_SKIP_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Cleaner note">
              <ETextarea
                rows={2}
                value={form.skipReasonNote}
                onChange={(e) => set({ skipReasonNote: e.target.value })}
                placeholder="Optional cleaner or operational note"
              />
            </EField>
            <EField label="Admin override note" hint="Shown to the laundry team when admin needs to clarify the skip.">
              <ETextarea
                rows={2}
                value={form.adminOverrideNote}
                onChange={(e) => set({ adminOverrideNote: e.target.value })}
                placeholder="Clarify the skip for the laundry team"
              />
            </EField>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Drop-off price (AUD)" hint="Amount billed for this job (used in reports). Blank keeps it unchanged.">
            <EInput
              type="number"
              min={0}
              step="0.01"
              value={form.totalPrice}
              onChange={(e) => set({ totalPrice: e.target.value })}
              placeholder="e.g. 45.00"
            />
          </EField>
          <EField label="Bag count" hint="Optional — recorded as evidence and shown in reports (1–50).">
            <EInput
              type="number"
              min={1}
              max={50}
              step="1"
              value={form.bagCount}
              onChange={(e) => set({ bagCount: e.target.value })}
              placeholder="e.g. 3"
            />
          </EField>
        </div>

        <EField
          label="Evidence photos"
          hint="Attach drop-off / receipt / pickup evidence for this status change. Recorded against the booking timeline."
        >
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="block w-full text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] file:mr-3 file:rounded-[var(--e-radius-sm)] file:border file:border-[hsl(var(--e-border-strong))] file:bg-[hsl(var(--e-surface))] file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-[550] file:text-[hsl(var(--e-foreground))] hover:file:bg-[hsl(var(--e-muted))]"
          />
          {files.length > 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              {files.length} photo{files.length === 1 ? "" : "s"} ready to attach.
            </p>
          ) : null}
        </EField>

        <EField label="Evidence note">
          <ETextarea
            rows={2}
            value={form.evidenceNote}
            onChange={(e) => set({ evidenceNote: e.target.value })}
            placeholder="Optional note explaining this manual status change"
          />
        </EField>

        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </EButton>
          <EButton variant="gold" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}
