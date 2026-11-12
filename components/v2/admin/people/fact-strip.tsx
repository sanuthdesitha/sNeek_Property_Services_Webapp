/**
 * The board's "fact" boxes: a label over a figure, with an optional badge.
 * A figure that could not be read arrives as null and shows "–", never 0.
 * Plain module (no hooks), usable from server and client components.
 * `collapsible` (the People tabs, owner decision 2026-11-13): below 640px the
 * boxes fold behind one "N figures · Show" row; nothing changes from 640px.
 */
import type { ReactNode } from "react";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";

export type Fact = { key: string; label: string; value: ReactNode | null; extra?: ReactNode };

export function FactStrip({ facts, label, collapsible }: { facts: Fact[]; label: string; collapsible?: { storageKey: string } }) {
  const strip = <FactBoxes facts={facts} label={label} />;
  if (!collapsible) return strip;
  return (
    <CollapsibleFigures storageKey={collapsible.storageKey} count={facts.length} label={label}>
      {strip}
    </CollapsibleFigures>
  );
}

function FactBoxes({ facts, label }: { facts: Fact[]; label: string }) {
  return (
    <section aria-label={label} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {facts.map((fact) => (
        <div key={fact.key} className="min-w-0 flex-1 rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2 sm:min-w-[9rem]">
          <p className="mb-0.5 text-[0.75rem] font-[500] text-[hsl(var(--e-muted-foreground))]">{fact.label}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="e-tnum text-[0.875rem]">{fact.value === null || fact.value === undefined ? "–" : fact.value}</b>
            {fact.extra}
          </div>
        </div>
      ))}
    </section>
  );
}
