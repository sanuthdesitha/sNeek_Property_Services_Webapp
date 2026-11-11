"use client";

/**
 * Line-item editor for a draft or approved invoice, moved from
 * estate-invoices.tsx. Same PATCH bodies for every edit. Removed from it in this
 * phase: the "Force status" control (the API refuses every override, so it only
 * ever produced an error) and a duplicate "Push to Xero" (the row offers it).
 * It becomes its own page in a later phase.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Building2, Layers, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EConfirmModal, EField, EInput, EModal, ESwitch, verifyAdminSecurity } from "@/components/v2/admin/estate-kit";
import { StartedWorkReviewPanel } from "../started-work-review";
import { SortableLineRow } from "./invoice-line-row";
import { money, type FullInvoice, type InvoiceLine, type InvoiceProperty, type InvoiceRow } from "./invoice-model";
import { getInvoice, patchInvoice } from "./invoice-requests";

/**
 * Which property a line groups under. The job wins when there is one; a manual
 * line uses its own hint; anything with neither sinks into one trailing bucket.
 */
const OTHER_CHARGES = "Other charges";
function linePropertyLabel(line: InvoiceLine): string {
  return line.job?.property?.name ?? line.property?.name ?? OTHER_CHARGES;
}

type EditorProps = {
  invoice: InvoiceRow;
  properties: InvoiceProperty[];
  onClose: () => void;
  onChanged: () => void;
};

export function InvoiceEditorDialog({ invoice, properties, onClose, onChanged }: EditorProps) {
  const [full, setFull] = useState<FullInvoice | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newLine, setNewLine] = useState({ description: "", quantity: "1", unitPrice: "0" });
  const [removeLineId, setRemoveLineId] = useState<string | null>(null);
  const clientProperties = properties.filter((prop) => prop.clientId === invoice.client.id);

  useEffect(() => {
    const controller = new AbortController();
    setFull(null);
    setLoadError(null);
    getInvoice<FullInvoice>(invoice.id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setFull(result.body);
        else setLoadError(result.body.error ?? "Could not load invoice.");
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError("Could not load invoice.");
      });
    return () => controller.abort();
  }, [invoice.id]);

  const reload = useCallback(async () => {
    const fresh = await getInvoice<FullInvoice>(invoice.id);
    if (fresh.ok) setFull(fresh.body);
    return fresh.ok;
  }, [invoice.id]);

  async function patchLines(body: Record<string, unknown>, message: string) {
    setSaving(true);
    try {
      const result = await patchInvoice(invoice.id, body);
      if (!result.ok) {
        toast({ title: "Update failed", description: result.body.error, variant: "destructive" });
        return;
      }
      // Re-fetch the full invoice so totals + line ids stay in sync.
      await reload();
      toast({ title: message });
      onChanged();
    } catch {
      toast({ title: "Could not reach the server", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function updateLineField(id: string, patch: Partial<InvoiceLine>) {
    setFull((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.map((l) =>
              l.id === id
                ? { ...l, ...patch, lineTotal: Number(patch.quantity ?? l.quantity) * Number(patch.unitPrice ?? l.unitPrice) }
                : l,
            ),
          }
        : prev,
    );
  }

  function saveLine(line: InvoiceLine) {
    return patchLines(
      { updateLines: [{ id: line.id, description: line.description.trim(), quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }] },
      "Line updated",
    );
  }

  async function addLine() {
    if (!newLine.description.trim()) {
      toast({ title: "Add a description", variant: "destructive" });
      return;
    }
    await patchLines(
      { addLine: { description: newLine.description.trim(), quantity: Number(newLine.quantity) || 1, unitPrice: Number(newLine.unitPrice) || 0 } },
      "Line added",
    );
    setNewLine({ description: "", quantity: "1", unitPrice: "0" });
  }

  async function removeLine(credentials?: { pin?: string; password?: string }) {
    const id = removeLineId;
    if (!id) return;
    try {
      // The invoice-lines route takes no security payload of its own.
      await verifyAdminSecurity(credentials);
    } catch (err: unknown) {
      toast({ title: "Line not removed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      return;
    }
    setRemoveLineId(null);
    await patchLines({ removeLineId: id }, "Line removed");
  }

  const dndSensors = useSensors(
    // A small distance threshold so clicking into a price field is not read as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Persist a whole new order, optimistically. */
  async function persistLineOrder(next: InvoiceLine[]) {
    if (!full) return;
    setFull({ ...full, lines: next });
    await patchLines({ reorderLineIds: next.map((l) => l.id) }, "Line order saved");
  }

  function onLineDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!full || !over || active.id === over.id) return;
    const from = full.lines.findIndex((l) => l.id === active.id);
    const to = full.lines.findIndex((l) => l.id === over.id);
    if (from < 0 || to < 0) return;
    void persistLineOrder(arrayMove(full.lines, from, to));
  }

  /**
   * Cluster lines by property, keeping the existing order inside each cluster,
   * then SAVE: the stored order is what the PDF and the emailed copy render.
   */
  function groupLinesByProperty() {
    if (!full) return;
    const key = (l: InvoiceLine) => {
      const label = linePropertyLabel(l);
      return label === OTHER_CHARGES ? "￿" : label;
    };
    const next = full.lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => key(a.line).localeCompare(key(b.line)) || a.index - b.index)
      .map((x) => x.line);
    void persistLineOrder(next);
  }

  return (
    <>
      <EModal open onClose={() => !saving && onClose()} eyebrow="Commercial" title={`Edit ${invoice.invoiceNumber}`} wide>
        {loadError ? (
          <p role="alert" className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-danger))]">
            {loadError}
          </p>
        ) : !full ? (
          <p role="status" className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading invoice…
          </p>
        ) : (
          <div className="space-y-5">
            {full.metadata?.startedWorkReview ? (
              <StartedWorkReviewPanel
                invoiceId={full.id}
                status={full.status}
                updatedAt={full.updatedAt}
                review={full.metadata.startedWorkReview}
                inspection={full.startedWorkStatus}
                onUpdated={async () => {
                  if (!(await reload())) throw new Error("Review saved, but invoice reload failed. Reopen it before continuing.");
                  onChanged();
                }}
              />
            ) : null}
            {full.totalsMismatch ? (
              <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger)/0.08)] p-3 text-[0.8125rem] font-medium text-[hsl(var(--e-danger))]">
                This invoice&rsquo;s stored total does not match its line items. Do not send it — edit any line (or the GST
                switch) to force a recalculation, then re-check.
              </p>
            ) : null}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <EEyebrow>Line items</EEyebrow>
                <EButton
                  size="sm"
                  variant="outline"
                  disabled={saving || full.lines.length < 2}
                  onClick={groupLinesByProperty}
                  title="Cluster lines by property, then fine-tune by dragging"
                >
                  <Layers className="h-3.5 w-3.5" /> Group by property
                </EButton>
              </div>
              {full.lines.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No line items yet — add one below.</p>
              ) : (
                <>
                  {full.lines.length > 1 ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Drag a row by its handle to reorder. Grouping saves immediately, so the PDF and the client’s copy match
                      what you see here.
                    </p>
                  ) : null}
                  <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onLineDragEnd}>
                    <SortableContext items={full.lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {full.lines.map((line, index) => {
                          const label = linePropertyLabel(line);
                          const previous = index > 0 ? linePropertyLabel(full.lines[index - 1]) : null;
                          return (
                            <Fragment key={line.id}>
                              {label !== previous ? (
                                <div className="flex items-center gap-1.5 pt-1.5 text-[0.75rem] font-semibold text-[hsl(var(--e-muted-foreground))]">
                                  <Building2 className="h-3 w-3" /> {label}
                                </div>
                              ) : null}
                              <SortableLineRow
                                line={line}
                                disabled={saving}
                                clientProperties={clientProperties}
                                onField={(patch) => updateLineField(line.id, patch)}
                                onSave={() => void saveLine(line)}
                                onRemove={() => setRemoveLineId(line.id)}
                                onProperty={(propertyId) =>
                                  void patchLines(
                                    { updateLines: [{ id: line.id, propertyId: propertyId || null }] },
                                    propertyId ? "Line grouped" : "Grouping cleared",
                                  )
                                }
                              />
                            </Fragment>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                </>
              )}
            </div>

            <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>Add a line</EEyebrow>
              <div className="grid grid-cols-1 items-end gap-2 sm:grid-cols-12">
                <EField label="Description" className="sm:col-span-5">
                  <EInput className="h-9" aria-label="New line description" value={newLine.description} onChange={(e) => setNewLine({ ...newLine, description: e.target.value })} />
                </EField>
                <EField label="Qty" className="sm:col-span-2">
                  <EInput className="h-9" aria-label="New line quantity" type="number" step="0.01" value={newLine.quantity} onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })} />
                </EField>
                <EField label="Unit price" className="sm:col-span-3">
                  <EInput className="h-9" aria-label="New line unit price" type="number" step="0.01" value={newLine.unitPrice} onChange={(e) => setNewLine({ ...newLine, unitPrice: e.target.value })} />
                </EField>
                <div className="sm:col-span-2">
                  <EButton className="w-full" size="sm" variant="outline" disabled={saving} onClick={addLine}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </EButton>
                </div>
              </div>
            </div>

            {/* GST toggle — same PATCH { gstEnabled } as before */}
            <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
              <div>
                <p className="text-[0.875rem] font-[550]">GST (10%)</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Toggle whether GST is added on top of the subtotal.</p>
              </div>
              <ESwitch
                checked={full.gstEnabled !== false}
                disabled={saving}
                onCheckedChange={(v) => void patchLines({ gstEnabled: v }, v ? "GST enabled" : "GST disabled")}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-[hsl(var(--e-border))] pt-4 sm:grid-cols-3">
              <div>
                <EEyebrow>Subtotal</EEyebrow>
                <p className="e-numeral mt-1 text-[1.125rem] leading-none">{money(full.subtotal)}</p>
              </div>
              <div>
                <EEyebrow>GST</EEyebrow>
                <p className="e-numeral mt-1 text-[1.125rem] leading-none">{money(full.gstAmount)}</p>
              </div>
              <div>
                <EEyebrow>Total</EEyebrow>
                <p className="e-numeral mt-1 text-[1.125rem] leading-none text-[hsl(var(--e-gold-ink))]">{money(full.totalAmount)}</p>
              </div>
            </div>
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Changes save per line (the ✓ button) and update totals immediately. Dragging reorders lines — the new order is
              saved straight away and flows to the PDF.
            </p>
          </div>
        )}
      </EModal>

      {/* PIN tier: a line is what the client is billed. Removing one rewrites
          the invoice total on a document that may already have been sent. */}
      <EConfirmModal
        open={Boolean(removeLineId)}
        onClose={() => setRemoveLineId(null)}
        title="Remove this invoice line"
        description="The charge comes off the invoice and the total is rewritten. Enter your PIN or password to continue."
        confirmLabel="Remove line"
        requireSecurity
        loading={saving}
        onConfirm={removeLine}
      />
    </>
  );
}
