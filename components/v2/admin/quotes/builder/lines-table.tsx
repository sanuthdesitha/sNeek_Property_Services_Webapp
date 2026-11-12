"use client";

/**
 * The quote's lines as one table (board: "Line · Price ex GST"): rate-card
 * and hand lines (editable), pricing adjustments (read-only), catalog extras
 * and custom extras (removable). The add row adds a line item, a catalog
 * extra (typed or picked by its name) or a custom extra with cleaner
 * instructions. The full extras catalog is a disclosure below.
 */
import * as React from "react";
import { Trash2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmButton, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { EXTRAS_BY_CATEGORY } from "@/lib/pricing/extras-catalog";
import { isPerUnitExtra, money } from "./model";
import { LazyDisclosure } from "./section-card";
import type { QuoteBuilderState } from "./use-quote-builder";

const CELL = "px-2 py-2 align-middle";
const REMOVE = "inline-flex h-9 min-w-[36px] items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-danger))] px-1.5 text-[0.6875rem] text-[hsl(var(--e-danger))]";
const ALL_EXTRAS = EXTRAS_BY_CATEGORY.flatMap((group) => group.options);

type AddKind = "line" | "custom";

function AddRow({ builder }: { builder: QuoteBuilderState }) {
  const p = builder.pricing;
  const [label, setLabel] = React.useState("");
  const [price, setPrice] = React.useState("");
  const [kind, setKind] = React.useState<AddKind>("line");
  const [instructions, setInstructions] = React.useState("");
  const listId = React.useId();
  const catalogMatch = ALL_EXTRAS.find((extra) => extra.label.toLowerCase() === label.trim().toLowerCase());

  function add() {
    const text = label.trim();
    if (!text) return;
    if (catalogMatch) {
      p.setSelectedExtras((prev) => (prev.includes(catalogMatch.id) ? prev : [...prev, catalogMatch.id]));
    } else if (kind === "custom") {
      p.addCustomExtra(text, Number(price) || 0, instructions.trim());
    } else {
      const unit = Number(price) || 0;
      p.setLineItems((prev) => [...prev, { label: text, unitPrice: unit, qty: 1, total: Number(unit.toFixed(2)) }]);
    }
    setLabel("");
    setPrice("");
    setInstructions("");
  }

  return (
    <tr className="border-t border-[hsl(var(--e-border))]">
      <td className={CELL} colSpan={2}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_7rem_9rem_auto]">
          <EInput aria-label="New line" list={listId} value={label} placeholder="Add a line item, extra or custom extra…" onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <datalist id={listId}>{ALL_EXTRAS.map((extra) => <option key={extra.id} value={extra.label} />)}</datalist>
          <EInput aria-label="Price" type="number" step="0.01" min="0" inputMode="decimal" value={catalogMatch ? String(catalogMatch.price) : price} disabled={Boolean(catalogMatch)} placeholder="Price" onChange={(e) => setPrice(e.target.value)} />
          <ESelect aria-label="Kind of line" value={catalogMatch ? "line" : kind} disabled={Boolean(catalogMatch)} onChange={(e) => setKind(e.target.value as AddKind)}>
            <option value="line">{catalogMatch ? "Catalog extra" : "Line item"}</option>
            <option value="custom">Custom extra</option>
          </ESelect>
          <EButton type="button" size="sm" variant="outline" onClick={add} disabled={!label.trim()}>Add</EButton>
        </div>
        {kind === "custom" && !catalogMatch ? (
          <EInput className="mt-2" aria-label="Instructions for the cleaner" value={instructions} placeholder="Instructions for the cleaner (optional, carried into the job)" onChange={(e) => setInstructions(e.target.value)} />
        ) : null}
      </td>
      <td className={CELL} />
    </tr>
  );
}

function ExtrasCatalog({ builder }: { builder: QuoteBuilderState }) {
  const p = builder.pricing;
  return (
    <div className="space-y-4">
      {EXTRAS_BY_CATEGORY.map((group) => (
        <fieldset key={group.id} className="space-y-2">
          <legend className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">{group.label}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.options.map((extra) => {
              const checked = p.selectedExtras.includes(extra.id);
              return (
                <label key={extra.id} className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" checked={checked} onChange={(ev) => p.setSelectedExtras((prev) => (ev.target.checked ? [...prev, extra.id] : prev.filter((id) => id !== extra.id)))} />
                    <span className="min-w-0 truncate">{extra.label}</span>
                  </span>
                  <span className="e-tnum shrink-0 text-[hsl(var(--e-muted-foreground))]">${extra.price}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function LinesTable({ builder }: { builder: QuoteBuilderState }) {
  const p = builder.pricing;
  const customIds = new Set(p.customExtras.map((c) => c.id));
  return (
    <div className="space-y-3">
      <div role="region" aria-label="Quote lines" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
        <table className="w-full min-w-[560px] text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-left text-[0.6875rem] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
            <tr><th className={CELL}>Line</th><th className={CELL}>Price ex GST</th><th className={CELL}><span className="sr-only">Remove</span></th></tr>
          </thead>
          <tbody>
            {p.lineItems.map((line, idx) => (
              <tr key={`line-${idx}`} className="border-t border-[hsl(var(--e-border))]">
                <td className={CELL}><EInput aria-label={`Line ${idx + 1} description`} value={line.label} placeholder="Description" onChange={(e) => p.updateItem(idx, { label: e.target.value })} /></td>
                <td className={CELL}>
                  <div className="flex items-center gap-1.5">
                    <EInput aria-label={`Line ${idx + 1} unit price`} className="w-24" type="number" step="0.01" value={line.unitPrice} onChange={(e) => p.updateItem(idx, { unitPrice: Number(e.target.value) })} />
                    <span aria-hidden>×</span>
                    <EInput aria-label={`Line ${idx + 1} quantity`} className="w-16" type="number" value={line.qty} onChange={(e) => p.updateItem(idx, { qty: Number(e.target.value) })} />
                    <span className="e-tnum w-20 text-right">{money(line.total)}</span>
                  </div>
                </td>
                <td className={CELL}>
                  <EConfirmButton ariaLabel={`Remove line ${line.label || idx + 1}`} confirmLabel="Remove?" className={REMOVE} onConfirm={() => p.setLineItems((prev) => prev.filter((_, i) => i !== idx))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </EConfirmButton>
                </td>
              </tr>
            ))}
            {p.variableLineItems.map((line, i) => (
              <tr key={`var-${i}`} className="border-t border-[hsl(var(--e-border))]">
                <td className={CELL}>{line.label} <EPill>Adjustment</EPill></td>
                <td className={`${CELL} e-tnum`}>{money(line.total)}</td>
                <td className={CELL} />
              </tr>
            ))}
            {p.selectedExtraDetails.map((extra) => {
              const perUnit = isPerUnitExtra(extra.label);
              const qty = perUnit ? p.extraQty(extra.id) : 1;
              const custom = customIds.has(extra.id);
              return (
                <tr key={extra.id} className="border-t border-[hsl(var(--e-border))]">
                  <td className={CELL}>
                    {extra.label} <EPill>{custom ? "Custom extra" : "Extra"}</EPill>
                    {extra.instructions && custom ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{extra.instructions}</span> : null}
                  </td>
                  <td className={CELL}>
                    <div className="flex items-center gap-1.5">
                      {perUnit ? (
                        <>
                          <EInput aria-label={`Quantity for ${extra.label}`} className="w-16" type="number" min="1" inputMode="numeric" value={p.extraQtys[extra.id] ?? "1"} onChange={(e) => p.setExtraQtys((prev) => ({ ...prev, [extra.id]: e.target.value }))} />
                          <span className="text-[hsl(var(--e-muted-foreground))]">× {money(extra.price)}</span>
                        </>
                      ) : null}
                      <span className="e-tnum">{money(extra.price * qty)}</span>
                    </div>
                  </td>
                  <td className={CELL}>
                    <EConfirmButton
                      ariaLabel={`Remove ${extra.label}`}
                      confirmLabel="Remove?"
                      className={REMOVE}
                      onConfirm={() => (custom ? p.setCustomExtras((prev) => prev.filter((c) => c.id !== extra.id)) : p.setSelectedExtras((prev) => prev.filter((id) => id !== extra.id)))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </EConfirmButton>
                  </td>
                </tr>
              );
            })}
            {p.allLines.length === 0 ? (
              <tr className="border-t border-[hsl(var(--e-border))]"><td className={`${CELL} text-[hsl(var(--e-muted-foreground))]`} colSpan={3}>No lines yet. Calculate from the rate card or add lines by hand.</td></tr>
            ) : null}
            <AddRow builder={builder} />
          </tbody>
        </table>
      </div>
      <LazyDisclosure title={`Extras catalog (${p.selectedExtras.length} chosen)`} description="Extras are added to the price and carried into the job as Additionals for the cleaner.">
        <ExtrasCatalog builder={builder} />
      </LazyDisclosure>
    </div>
  );
}
