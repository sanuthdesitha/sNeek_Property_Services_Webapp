"use client";

/**
 * One editable invoice line, moved unchanged from estate-invoices.tsx.
 */
import { format } from "date-fns";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, GripVertical, Trash2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { money, type InvoiceLine, type InvoiceProperty } from "./invoice-model";

/**
 * One editable line, draggable by its handle.
 *
 * The handle is deliberately the only drag target: the row is full of number
 * inputs, and making the whole row draggable would fight every attempt to put a
 * cursor in one. The KeyboardSensor keeps the handle operable without a mouse,
 * which is why the old up/down buttons could be retired rather than kept
 * alongside it.
 */
export function SortableLineRow({
  line,
  disabled,
  clientProperties,
  onField,
  onSave,
  onRemove,
  onProperty,
}: {
  line: InvoiceLine;
  disabled: boolean;
  clientProperties: InvoiceProperty[];
  onField: (patch: Partial<InvoiceLine>) => void;
  onSave: () => void;
  onRemove: () => void;
  onProperty: (propertyId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 " +
        (isDragging ? "opacity-60 shadow-lg" : "")
      }
    >
      <div className="grid grid-cols-2 items-center gap-2 md:grid-cols-12">
        <button
          type="button"
          className="col-span-2 flex cursor-grab items-center justify-center md:col-span-1 text-[hsl(var(--e-muted-foreground))] active:cursor-grabbing"
          aria-label={"Reorder " + line.description}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <EInput
          className="col-span-2 h-9 md:col-span-4"
          value={line.description}
          placeholder="Description"
          onChange={(e) => onField({ description: e.target.value })}
        />
        <EInput
          className="col-span-1 h-9 md:col-span-2"
          type="number"
          step="0.01"
          value={line.quantity}
          onChange={(e) => onField({ quantity: Number(e.target.value) })}
          title="Quantity"
        />
        <EInput
          className="col-span-1 h-9 md:col-span-2"
          type="number"
          step="0.01"
          value={line.unitPrice}
          onChange={(e) => onField({ unitPrice: Number(e.target.value) })}
          title="Unit price"
        />
        <div className="col-span-1 text-right text-[0.8125rem] e-tnum">{money(line.lineTotal)}</div>
        <div className="col-span-1 flex justify-end gap-1">
          <EButton
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={disabled}
            onClick={onSave}
            title="Save this line"
          >
            <Check className="h-4 w-4 text-[hsl(var(--e-success))]" />
          </EButton>
          <EButton
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={disabled}
            onClick={onRemove}
            title="Remove this line"
          >
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        </div>
      </div>

      {/* Context row: where this charge came from. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-0 md:pl-[8.333%] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {line.job ? (
          // Job-backed: state the source. Its property is fixed by the job, so no
          // control is offered here — the API would refuse the change anyway.
          <span>
            #{line.job.jobNumber ?? line.job.id.slice(0, 8)}
            {" · "}
            {format(new Date(line.job.scheduledDate), "dd MMM yyyy")}
            {line.job.property ? " · " + line.job.property.name : ""}
          </span>
        ) : (
          <>
            <span>Manual charge — group under</span>
            <ESelect
              className="h-9 w-auto min-w-[150px] text-[0.75rem] sm:h-7"
              value={line.property?.id ?? ""}
              disabled={disabled}
              onChange={(e) => onProperty(e.target.value)}
            >
              <option value="">Other charges</option>
              {clientProperties.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
            </ESelect>
          </>
        )}
      </div>
    </div>
  );
}
