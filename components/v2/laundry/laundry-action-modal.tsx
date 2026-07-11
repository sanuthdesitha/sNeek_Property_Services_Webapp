"use client";

/**
 * ESTATE — laundry task action modal. Native v2 port of the v1 planner's action
 * dialog (`app/laundry/page.tsx`), covering the FULL action surface against the
 * SAME endpoint contract:
 *
 *   POST  /api/laundry/[taskId]/status   status: PICKED_UP | RETURNED |
 *         REVERT_TO_CONFIRMED | REVERT_TO_PICKED_UP |
 *         FAILED_PICKUP_RESCHEDULE | FAILED_PICKUP_REQUEST
 *   PATCH /api/laundry/[taskId]/status   post-completion corrections
 *         (bagCount / dropoffLocation / totalPrice / loadWeightKg / supplierId /
 *          earlyDropoffReason / photo keys, notes = required correction reason)
 *
 * Field parity with v1: bag count, pickup photo + key-handling photo, drop-off
 * location (admin-configured options + custom), drop-off photo (required when
 * the portal config says so) + key-return photo, total price, load weight,
 * supplier, receipt photo, early-drop-off reason (required when returning ahead
 * of schedule and the config demands a reason), failed-pickup reschedule /
 * skip-request / delete-request, and the "I confirm" checkbox gate.
 *
 * Options/config come from GET /api/laundry/options (same feed v1 used).
 * Zero v1 UI imports — Estate v2 kit only.
 */
import * as React from "react";
import { addDays, format, startOfDay } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";
import { ECheckbox, EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import { toast } from "@/hooks/use-toast";

/* ── Types ─────────────────────────────────────────────────────────────────── */

export type LaundryAction =
  | "PICKED_UP"
  | "RETURNED"
  | "EDIT_COMPLETED"
  | "FAILED_PICKUP"
  | "REVERT_TO_CONFIRMED"
  | "REVERT_TO_PICKED_UP";

type FailedPickupMode = "RESCHEDULE" | "REQUEST_SKIP" | "REQUEST_DELETE";

/** Structural task shape — matches the /api/laundry/week rows the boards hold. */
export type ActionTask = {
  id: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  receiptImageUrl?: string | null;
  supplierId?: string | null;
  flagNotes?: string | null;
  property?: { name?: string | null; suburb?: string | null } | null;
  confirmations?: Array<{ notes?: string | null; bagLocation?: string | null }>;
};

export type Supplier = { id: string; name: string };

export type LaundryPortalConfig = {
  showPickupPhoto: boolean;
  requireDropoffPhoto: boolean;
  requireEarlyDropoffReason: boolean;
  showCostTracking: boolean;
};

const DEFAULT_CONFIG: LaundryPortalConfig = {
  showPickupPhoto: true,
  requireDropoffPhoto: true,
  requireEarlyDropoffReason: true,
  showCostTracking: true,
};

/* ── Options hook (GET /api/laundry/options) ───────────────────────────────── */

export function useLaundryOptions() {
  const [dropoffOptions, setDropoffOptions] = React.useState<string[]>([]);
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [config, setConfig] = React.useState<LaundryPortalConfig>(DEFAULT_CONFIG);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/laundry/options", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setDropoffOptions(Array.isArray(data?.dropoffLocationOptions) ? data.dropoffLocationOptions : []);
        setSuppliers(
          Array.isArray(data?.suppliers)
            ? data.suppliers.map((s: any) => ({ id: String(s.id), name: String(s.name ?? "Supplier") }))
            : []
        );
        const vis = data?.portalVisibility ?? {};
        setConfig({
          showPickupPhoto: typeof vis.showPickupPhoto === "boolean" ? vis.showPickupPhoto : true,
          requireDropoffPhoto: typeof vis.requireDropoffPhoto === "boolean" ? vis.requireDropoffPhoto : true,
          requireEarlyDropoffReason:
            typeof vis.requireEarlyDropoffReason === "boolean" ? vis.requireEarlyDropoffReason : true,
          showCostTracking: typeof vis.showCostTracking === "boolean" ? vis.showCostTracking : true,
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { dropoffOptions, suppliers, config };
}

/* ── Completion metadata helpers (same JSON-notes event model as v1) ───────── */

function parseEventNotes(notes: string | null | undefined): any {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function getEventMeta(task: ActionTask, eventName: string) {
  const confirmations = Array.isArray(task.confirmations) ? [...task.confirmations] : [];
  const row = confirmations.reverse().find((c) => parseEventNotes(c?.notes)?.event === eventName);
  return row ? parseEventNotes(row.notes) : null;
}

export function getCompletionDetails(task: ActionTask) {
  const pickupMeta = getEventMeta(task, "PICKED_UP") ?? {};
  const droppedMeta = getEventMeta(task, "DROPPED") ?? {};
  return {
    bagCount:
      typeof pickupMeta.bagCount === "number" && Number.isFinite(pickupMeta.bagCount)
        ? Math.max(1, Math.round(pickupMeta.bagCount))
        : 1,
    dropoffLocation:
      typeof droppedMeta.dropoffLocation === "string" && droppedMeta.dropoffLocation.trim()
        ? droppedMeta.dropoffLocation.trim()
        : "",
    totalPrice:
      typeof droppedMeta.totalPrice === "number" && Number.isFinite(droppedMeta.totalPrice)
        ? droppedMeta.totalPrice
        : null,
    loadWeightKg:
      typeof droppedMeta.loadWeightKg === "number" && Number.isFinite(droppedMeta.loadWeightKg)
        ? droppedMeta.loadWeightKg
        : null,
    supplierId:
      typeof droppedMeta.supplierId === "string" && droppedMeta.supplierId.trim()
        ? droppedMeta.supplierId.trim()
        : typeof task.supplierId === "string" && task.supplierId.trim()
          ? task.supplierId.trim()
          : "",
    earlyDropoffReason: typeof droppedMeta.earlyDropoffReason === "string" ? droppedMeta.earlyDropoffReason : "",
    notes: typeof droppedMeta.notes === "string" && droppedMeta.notes.trim() ? droppedMeta.notes : "",
  };
}

export function isEarlyDropoffCandidate(task: ActionTask): boolean {
  if (!task.dropoffDate) return false;
  return startOfDay(new Date()).getTime() < startOfDay(new Date(task.dropoffDate)).getTime();
}

const ACTION_TITLE: Record<LaundryAction, string> = {
  PICKED_UP: "Confirm pickup",
  RETURNED: "Confirm drop-off",
  EDIT_COMPLETED: "Edit completed laundry",
  FAILED_PICKUP: "Report failed pickup",
  REVERT_TO_CONFIRMED: "Revert to confirmed",
  REVERT_TO_PICKED_UP: "Revert to picked up",
};

/* ── Modal ─────────────────────────────────────────────────────────────────── */

export function LaundryActionModal({
  task,
  action,
  dropoffOptions,
  suppliers,
  config,
  onClose,
  onDone,
}: {
  task: ActionTask;
  action: LaundryAction;
  dropoffOptions: string[];
  suppliers: Supplier[];
  config: LaundryPortalConfig;
  onClose: () => void;
  onDone: () => void;
}) {
  const completion = React.useMemo(() => getCompletionDetails(task), [task]);
  const isEdit = action === "EDIT_COMPLETED";
  const earlyReturn = action === "RETURNED" && isEarlyDropoffCandidate(task);

  const [bagCount, setBagCount] = React.useState(isEdit ? String(completion.bagCount) : "1");
  const [dropoffSelection, setDropoffSelection] = React.useState(() => {
    if (isEdit && completion.dropoffLocation) {
      return dropoffOptions.includes(completion.dropoffLocation) ? completion.dropoffLocation : "__custom";
    }
    return dropoffOptions[0] ?? "__custom";
  });
  const [dropoffCustom, setDropoffCustom] = React.useState(
    isEdit && completion.dropoffLocation && !dropoffOptions.includes(completion.dropoffLocation)
      ? completion.dropoffLocation
      : ""
  );
  const [totalPrice, setTotalPrice] = React.useState(
    isEdit && completion.totalPrice != null ? String(completion.totalPrice) : ""
  );
  const [weightKg, setWeightKg] = React.useState(
    isEdit && completion.loadWeightKg != null ? String(completion.loadWeightKg) : ""
  );
  const [supplierId, setSupplierId] = React.useState(isEdit && completion.supplierId ? completion.supplierId : "");
  const [earlyReason, setEarlyReason] = React.useState(isEdit ? completion.earlyDropoffReason : "");
  const [notes, setNotes] = React.useState(isEdit ? completion.notes : "");
  const [failedMode, setFailedMode] = React.useState<FailedPickupMode>("RESCHEDULE");
  const [failedDate, setFailedDate] = React.useState("");
  const [failedReason, setFailedReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [pickupPhoto, setPickupPhoto] = React.useState<CapturedMedia[]>([]);
  const [pickupKeyPhoto, setPickupKeyPhoto] = React.useState<CapturedMedia[]>([]);
  const [dropoffPhoto, setDropoffPhoto] = React.useState<CapturedMedia[]>([]);
  const [dropoffKeyPhoto, setDropoffKeyPhoto] = React.useState<CapturedMedia[]>([]);
  const [receiptPhoto, setReceiptPhoto] = React.useState<CapturedMedia[]>([]);

  const propertyLine = [task.property?.name, task.property?.suburb].filter(Boolean).join(" · ");

  function fail(title: string, description?: string) {
    toast({ title, description, variant: "destructive" });
  }

  async function submit() {
    if (!confirmed) {
      fail("Confirm action first", "Tick the confirmation checkbox.");
      return;
    }

    // ── EDIT_COMPLETED → PATCH ──────────────────────────────────────────────
    if (action === "EDIT_COMPLETED") {
      const reason = notes.trim();
      if (reason.length < 3) {
        fail("Correction reason required", "Add a short reason for this post-completion edit.");
        return;
      }
      const n = Number(bagCount || 0);
      if (!Number.isFinite(n) || n < 1) {
        fail("Bag count required", "Enter how many bags were picked up.");
        return;
      }
      const location = dropoffSelection === "__custom" ? dropoffCustom.trim() : dropoffSelection;
      if (!location) {
        fail("Location required", "Select or type the drop-off location.");
        return;
      }
      const payload: Record<string, unknown> = {
        confirm: true,
        notes: reason,
        bagCount: Math.round(n),
        dropoffLocation: location,
      };
      if (totalPrice.trim()) {
        const price = Number(totalPrice);
        if (!Number.isFinite(price) || price < 0) return fail("Invalid price", "Enter a valid total laundry price.");
        payload.totalPrice = Number(price.toFixed(2));
      }
      if (weightKg.trim()) {
        const weight = Number(weightKg);
        if (!Number.isFinite(weight) || weight < 0) return fail("Invalid weight", "Enter a valid load weight (kg).");
        payload.loadWeightKg = Number(weight.toFixed(2));
      }
      if (supplierId) payload.supplierId = supplierId;
      if (earlyReason.trim()) payload.earlyDropoffReason = earlyReason.trim();
      if (pickupPhoto[0]?.key) payload.pickupPhotoKey = pickupPhoto[0].key;
      if (dropoffPhoto[0]?.key) payload.dropoffPhotoKey = dropoffPhoto[0].key;
      if (receiptPhoto[0]?.key) payload.receiptImageKey = receiptPhoto[0].key;

      setSubmitting(true);
      try {
        const res = await fetch(`/api/laundry/${task.id}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return fail("Update failed", body?.error ?? "Could not update completed laundry details.");
        toast({ title: "Completed laundry details updated" });
        onDone();
      } catch (err: any) {
        fail("Update failed", err?.message ?? "Network error — check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── FAILED_PICKUP → POST reschedule / approval request ──────────────────
    if (action === "FAILED_PICKUP") {
      const reason = failedReason.trim();
      if (!reason) return fail("Reason required", "Explain why the pickup failed.");
      const payload: Record<string, unknown> = {
        confirm: true,
        notes: notes.trim() || undefined,
        failedPickupReason: reason,
      };
      if (failedMode === "RESCHEDULE") {
        if (!failedDate.trim()) return fail("New pickup date required", "Choose the rescheduled pickup date.");
        payload.status = "FAILED_PICKUP_RESCHEDULE";
        payload.rescheduledPickupDate = `${failedDate.trim()}T00:00:00.000Z`;
      } else {
        payload.status = "FAILED_PICKUP_REQUEST";
        payload.requestedAction = failedMode === "REQUEST_DELETE" ? "DELETE" : "SKIP";
      }
      setSubmitting(true);
      try {
        const res = await fetch(`/api/laundry/${task.id}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return fail("Update failed", body?.error ?? "Could not save the failed pickup update.");
        toast({
          title: failedMode === "RESCHEDULE" ? "Pickup rescheduled" : "Approval request sent",
          description:
            failedMode === "RESCHEDULE"
              ? "The pickup date has been updated and admin has been notified."
              : "Admin approval is now required before this pickup can be skipped or deleted.",
        });
        onDone();
      } catch (err: any) {
        fail("Update failed", err?.message ?? "Network error — check your connection and try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // ── PICKED_UP / RETURNED / REVERT_* → POST ──────────────────────────────
    const payload: Record<string, unknown> = {
      status: action,
      confirm: true,
      notes: notes.trim() || undefined,
    };

    if (action === "PICKED_UP") {
      const n = Number(bagCount || 0);
      if (!Number.isFinite(n) || n < 1) return fail("Bag count required", "Enter how many bags were picked up.");
      payload.bagCount = Math.round(n);
      if (pickupPhoto[0]?.key) payload.pickupPhotoKey = pickupPhoto[0].key;
      if (pickupKeyPhoto[0]?.key) payload.pickupKeyPhotoKey = pickupKeyPhoto[0].key;
    }

    if (action === "RETURNED") {
      const location = dropoffSelection === "__custom" ? dropoffCustom.trim() : dropoffSelection;
      if (!location) return fail("Location required", "Select or type the drop-off location.");
      if (config.requireDropoffPhoto && !dropoffPhoto[0]?.key) {
        return fail("Photo required", "Add a drop-off evidence photo.");
      }
      payload.dropoffLocation = location;
      if (totalPrice.trim()) {
        const price = Number(totalPrice);
        if (!Number.isFinite(price) || price < 0) return fail("Invalid price", "Enter a valid total laundry price.");
        payload.totalPrice = Number(price.toFixed(2));
      }
      if (weightKg.trim()) {
        const weight = Number(weightKg);
        if (!Number.isFinite(weight) || weight < 0) return fail("Invalid weight", "Enter a valid load weight (kg).");
        payload.loadWeightKg = Number(weight.toFixed(2));
      }
      if (supplierId) payload.supplierId = supplierId;
      if (config.requireEarlyDropoffReason && earlyReturn) {
        if (!earlyReason.trim()) {
          return fail("Reason required", "Explain why this linen was returned earlier than the planned date.");
        }
        payload.earlyDropoffReason = earlyReason.trim();
      } else if (earlyReason.trim()) {
        payload.earlyDropoffReason = earlyReason.trim();
      }
      if (dropoffPhoto[0]?.key) payload.dropoffPhotoKey = dropoffPhoto[0].key;
      if (dropoffKeyPhoto[0]?.key) payload.dropoffKeyPhotoKey = dropoffKeyPhoto[0].key;
      if (receiptPhoto[0]?.key) payload.receiptImageKey = receiptPhoto[0].key;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/laundry/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return fail("Update failed", body?.error ?? "Could not update status.");
      toast({ title: "Laundry updated" });
      onDone();
    } catch (err: any) {
      fail("Update failed", err?.message ?? "Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const showDropoffFields = action === "RETURNED" || action === "EDIT_COMPLETED";

  return (
    <EModal open onClose={onClose} eyebrow="Laundry" title={ACTION_TITLE[action]} size="wide">
      <div className="space-y-4">
        {propertyLine ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{propertyLine}</p>
        ) : null}

        {/* Pickup fields */}
        {action === "PICKED_UP" || action === "EDIT_COMPLETED" ? (
          <EField label={action === "EDIT_COMPLETED" ? "Bag count (correction)" : "How many bags picked up?"}>
            <EInput type="number" min={1} max={50} value={bagCount} onChange={(e) => setBagCount(e.target.value)} />
          </EField>
        ) : null}

        {action === "PICKED_UP" ? (
          <>
            <EField label="Key handling photo (optional)" hint="Proof of the key at pickup.">
              <MediaCapture value={pickupKeyPhoto} onChange={setPickupKeyPhoto} mode="photo" folder="laundry/key" multiple={false} stamp={{ tag: "laundry", reference: task.property?.name ?? undefined, contextLabel: "Key photo (pickup)" }} />
            </EField>
            {config.showPickupPhoto ? (
              <EField label="Pickup photo (optional)">
                <MediaCapture value={pickupPhoto} onChange={setPickupPhoto} mode="photo" folder="laundry/pickup" multiple={false} stamp={{ tag: "laundry", reference: task.property?.name ?? undefined, contextLabel: "Pickup photo" }} />
              </EField>
            ) : null}
          </>
        ) : null}

        {action === "EDIT_COMPLETED" ? (
          <EField label="Pickup photo (optional replacement)" hint="Leave empty to keep the existing pickup photo.">
            <MediaCapture value={pickupPhoto} onChange={setPickupPhoto} mode="photo" folder="laundry/pickup" multiple={false} stamp={{ tag: "laundry", reference: task.property?.name ?? undefined, contextLabel: "Pickup photo" }} />
          </EField>
        ) : null}

        {/* Drop-off fields */}
        {showDropoffFields ? (
          <>
            {earlyReturn && config.requireEarlyDropoffReason ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.1)] p-3 text-[0.8125rem]">
                <p className="inline-flex items-center gap-1.5 font-[600]">
                  <AlertTriangle className="h-4 w-4" /> Early drop-off detected
                </p>
                <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">
                  Intended drop-off: {format(new Date(task.dropoffDate), "dd MMM yyyy")} · Actual:{" "}
                  {format(new Date(), "dd MMM yyyy")}
                </p>
              </div>
            ) : null}

            <EField label="Drop-off location">
              {dropoffOptions.length > 0 ? (
                <div className="space-y-2">
                  <ESelect value={dropoffSelection} onChange={(e) => setDropoffSelection(e.target.value)}>
                    {dropoffOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                    <option value="__custom">Custom location…</option>
                  </ESelect>
                  {dropoffSelection === "__custom" ? (
                    <EInput
                      value={dropoffCustom}
                      onChange={(e) => setDropoffCustom(e.target.value)}
                      placeholder="Type custom location"
                    />
                  ) : null}
                </div>
              ) : (
                <EInput value={dropoffCustom} onChange={(e) => setDropoffCustom(e.target.value)} placeholder="Type location" />
              )}
            </EField>

            {action === "RETURNED" ? (
              <EField label="Key return photo (optional)" hint="Proof the key was returned.">
                <MediaCapture value={dropoffKeyPhoto} onChange={setDropoffKeyPhoto} mode="photo" folder="laundry/key" multiple={false} stamp={{ tag: "laundry", reference: task.property?.name ?? undefined, contextLabel: "Key photo (drop-off)" }} />
              </EField>
            ) : null}

            <EField
              label={
                action === "EDIT_COMPLETED"
                  ? "Drop-off photo (optional replacement)"
                  : config.requireDropoffPhoto
                    ? "Drop-off photo (required)"
                    : "Drop-off photo (optional)"
              }
            >
              <MediaCapture value={dropoffPhoto} onChange={setDropoffPhoto} mode="photo" folder="laundry/dropoff" multiple={false} stamp={{ tag: "laundry", reference: task.property?.name ?? undefined, contextLabel: "Drop-off photo" }} />
            </EField>

            {config.showCostTracking ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <EField label="Total price charged (optional)">
                  <EInput type="number" min={0} step="0.01" inputMode="decimal" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} placeholder="0.00" />
                </EField>
                <EField label="Load weight in kg (optional)">
                  <EInput type="number" min={0} step="0.1" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="0.0" />
                </EField>
              </div>
            ) : (
              <EField label="Load weight in kg (optional)">
                <EInput type="number" min={0} step="0.1" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="0.0" />
              </EField>
            )}

            <EField label="Supplier (optional)">
              <ESelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">No supplier selected</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </ESelect>
            </EField>

            <EField
              label="Receipt photo (optional)"
              hint={action === "EDIT_COMPLETED" && task.receiptImageUrl ? "Leave empty to keep the existing receipt image." : undefined}
            >
              <MediaCapture value={receiptPhoto} onChange={setReceiptPhoto} mode="photo" folder="laundry/receipt" multiple={false} stamp={{ tag: "laundry", reference: task.property?.name ?? undefined, contextLabel: "Laundromat receipt" }} />
            </EField>

            {(earlyReturn && config.requireEarlyDropoffReason) || (action === "EDIT_COMPLETED" && completion.earlyDropoffReason) ? (
              <EField label="Reason for early drop-off">
                <ETextarea
                  value={earlyReason}
                  onChange={(e) => setEarlyReason(e.target.value)}
                  placeholder="Explain why this was returned earlier than planned"
                  rows={2}
                />
              </EField>
            ) : null}
          </>
        ) : null}

        {/* Failed pickup fields */}
        {action === "FAILED_PICKUP" ? (
          <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.06)] p-3">
            <EField label="What should happen next?">
              <ESelect value={failedMode} onChange={(e) => setFailedMode(e.target.value as FailedPickupMode)}>
                <option value="RESCHEDULE">Reschedule pickup</option>
                <option value="REQUEST_SKIP">Request skip approval</option>
                <option value="REQUEST_DELETE">Request delete approval</option>
              </ESelect>
            </EField>
            <EField label="Why did the pickup fail?">
              <ETextarea
                value={failedReason}
                onChange={(e) => setFailedReason(e.target.value)}
                placeholder="No bag outside, access issue, property not ready, cleaner delayed…"
                rows={3}
              />
            </EField>
            {failedMode === "RESCHEDULE" ? (
              <EField
                label="New pickup date"
                hint="Rescheduling updates the pickup date immediately and keeps the task live."
              >
                <EInput
                  type="date"
                  value={failedDate}
                  min={task.pickupDate ? format(addDays(new Date(task.pickupDate), 1), "yyyy-MM-dd") : undefined}
                  onChange={(e) => setFailedDate(e.target.value)}
                />
              </EField>
            ) : (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                This flags the task and sends an approval request to admin before it can be skipped or deleted.
              </p>
            )}
          </div>
        ) : null}

        {/* Notes + confirm */}
        <EField label={action === "EDIT_COMPLETED" ? "Correction reason (required)" : "Notes (optional)"}>
          <ETextarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={action === "EDIT_COMPLETED" ? "Explain why you are changing completed task details" : undefined}
            rows={2}
          />
        </EField>

        <label className="flex cursor-pointer items-center gap-2 text-[0.875rem]">
          <ECheckbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm this action is correct.
        </label>

        <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </EButton>
          <EButton onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Saving…" : "Confirm"}
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

/* ── Convenience hook: one modal instance shared by a board ────────────────── */

export function useLaundryActionModal(onDone: () => void) {
  const { dropoffOptions, suppliers, config } = useLaundryOptions();
  const [state, setState] = React.useState<{ task: ActionTask; action: LaundryAction } | null>(null);

  const openAction = React.useCallback((task: ActionTask, action: LaundryAction) => {
    setState({ task, action });
  }, []);

  const modal = state ? (
    <LaundryActionModal
      task={state.task}
      action={state.action}
      dropoffOptions={dropoffOptions}
      suppliers={suppliers}
      config={config}
      onClose={() => setState(null)}
      onDone={() => {
        setState(null);
        onDone();
      }}
    />
  ) : null;

  return { openAction, modal, config };
}
