"use client";

/**
 * THE SHOPPING LIST, THREE WAYS.
 *
 * The same needs answer three different questions, and which one you want
 * depends entirely on where you are standing:
 *
 *   BY ITEM      in the aisle. "How many bottles do I pick up?" — one row per
 *                product, everything added together.
 *   BY SUPPLIER  planning the trip. "What can I get in one shop?"
 *   BY PROPERTY  back at the car. "What comes out of the boot here?"
 *
 * By item leads because it is the only one that answers the question you have
 * while actually shopping, which is when the list is open.
 *
 * Every row carries its per-property split even in the item view. Six bottles
 * with no idea where four of them go is a number you cannot act on once you
 * have paid for them.
 */

import * as React from "react";
import { Building2, PackageSearch, ShoppingCart, Store } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";

interface ConsolidatedLine {
  itemId: string;
  itemName: string;
  totalNeeded: number;
  supplier: string | null;
  unit: string | null;
  category: string | null;
  breakdown: Array<{ propertyId: string; propertyName: string; needed: number }>;
  propertyCount: number;
}

interface Basket {
  supplier: string;
  lines: ConsolidatedLine[];
  itemCount: number;
  totalUnits: number;
}

interface NeedsResponse {
  consolidated: ConsolidatedLine[];
  baskets: Basket[];
  propertyCount: number;
}

type Mode = "item" | "supplier" | "property";

const MODES: Array<{ key: Mode; label: string; icon: typeof ShoppingCart }> = [
  { key: "item", label: "By item", icon: ShoppingCart },
  { key: "supplier", label: "By supplier", icon: Store },
  { key: "property", label: "By property", icon: Building2 },
];

function qty(n: number, unit: string | null) {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ""}`;
}

export function ConsolidatedShopping() {
  const [data, setData] = React.useState<NeedsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [mode, setMode] = React.useState<Mode>("item");

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/inventory/shopping-needs");
        const body = await res.json();
        if (!cancelled && res.ok) setData(body);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The property view is derived here rather than fetched: it is the same rows
   * turned inside out, and a second endpoint returning the same numbers in a
   * different shape is a second chance for them to disagree.
   */
  const byProperty = React.useMemo(() => {
    const map = new Map<
      string,
      {
        propertyName: string;
        lines: Array<{ itemName: string; needed: number; unit: string | null }>;
      }
    >();
    for (const line of data?.consolidated ?? []) {
      for (const drop of line.breakdown) {
        const entry = map.get(drop.propertyId) ?? { propertyName: drop.propertyName, lines: [] };
        entry.lines.push({ itemName: line.itemName, needed: drop.needed, unit: line.unit });
        map.set(drop.propertyId, entry);
      }
    }
    return Array.from(map.entries())
      .map(([propertyId, entry]) => ({ propertyId, ...entry }))
      .sort(
        (a, b) => b.lines.length - a.lines.length || a.propertyName.localeCompare(b.propertyName)
      );
  }, [data]);

  if (loading) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>;
  }

  if (!data || data.consolidated.length === 0) {
    return (
      <EEmptyState
        eyebrow="All stocked"
        title="Nothing needs buying"
        description="No property is below its reorder threshold."
      />
    );
  }

  const totalUnits = data.consolidated.reduce((sum, line) => sum + line.totalNeeded, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          {data.consolidated.length} item{data.consolidated.length === 1 ? "" : "s"} ·{" "}
          {qty(totalUnits, null)} units · {data.propertyCount} propert
          {data.propertyCount === 1 ? "y" : "ies"}
        </p>
        <div className="flex gap-1.5">
          {MODES.map((m) => (
            <EButton
              key={m.key}
              size="sm"
              variant={mode === m.key ? "gold" : "outline"}
              onClick={() => setMode(m.key)}
            >
              <m.icon className="h-3.5 w-3.5" /> {m.label}
            </EButton>
          ))}
        </div>
      </div>

      {mode === "item" ? (
        <ECard>
          <ECardBody className="pt-4">
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {data.consolidated.map((line) => (
                <li key={line.itemId} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[0.9375rem] font-[600]">{line.itemName}</span>
                    <span className="e-tnum text-[1rem] font-[700]">
                      {qty(line.totalNeeded, line.unit)}
                    </span>
                  </div>
                  {/* Where it goes. Six bottles with no idea where four of them
                      belong is a number you cannot act on once you have paid. */}
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {line.breakdown
                      .map((drop) => `${drop.propertyName} ${qty(drop.needed, null)}`)
                      .join(" · ")}
                  </p>
                  {line.supplier ? (
                    <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {line.supplier}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </ECardBody>
        </ECard>
      ) : null}

      {mode === "supplier"
        ? data.baskets.map((basket) => (
            <ECard key={basket.supplier}>
              <ECardHeader className="pb-2">
                <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
                  <Store className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
                  {basket.supplier}
                  <EBadge tone="neutral" soft>
                    {basket.itemCount} item{basket.itemCount === 1 ? "" : "s"}
                  </EBadge>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="pt-0">
                <ul className="divide-y divide-[hsl(var(--e-border))]">
                  {basket.lines.map((line) => (
                    <li key={line.itemId} className="flex items-center justify-between gap-2 py-2">
                      <span className="truncate text-[0.875rem]">{line.itemName}</span>
                      <span className="e-tnum text-[0.875rem] font-[600]">
                        {qty(line.totalNeeded, line.unit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </ECardBody>
            </ECard>
          ))
        : null}

      {mode === "property"
        ? byProperty.map((property) => (
            <ECard key={property.propertyId}>
              <ECardHeader className="pb-2">
                <ECardTitle className="flex items-center gap-2 text-[0.95rem]">
                  <Building2 className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
                  {property.propertyName}
                  <EBadge tone="neutral" soft>
                    {property.lines.length}
                  </EBadge>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="pt-0">
                <ul className="divide-y divide-[hsl(var(--e-border))]">
                  {property.lines.map((line) => (
                    <li
                      key={`${property.propertyId}-${line.itemName}`}
                      className="flex items-center justify-between gap-2 py-2"
                    >
                      <span className="truncate text-[0.875rem]">{line.itemName}</span>
                      <span className="e-tnum text-[0.875rem] font-[600]">
                        {qty(line.needed, line.unit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </ECardBody>
            </ECard>
          ))
        : null}

      <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        <PackageSearch className="h-3.5 w-3.5" />
        Quantities bring each property back up to its par level.
      </p>
    </div>
  );
}
