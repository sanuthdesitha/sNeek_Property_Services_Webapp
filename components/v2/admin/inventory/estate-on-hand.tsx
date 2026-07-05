"use client";

/**
 * ESTATE on-hand holdings — v2-native read view of who currently holds stock.
 *   GET /api/admin/inventory/held-stock → { byHolder: [{ holder, items:[{ heldStockId, item, quantity }] }] }
 * Recording new holdings / delivering to a property is a deep flow kept in the
 * classic inventory desk (EClassicLink).
 */
import { useEffect, useMemo, useState } from "react";
import { PackageCheck } from "lucide-react";
import { EBadge, ECard, EStatCard } from "@/components/v2/ui/primitives";
import { EAvatar, EClassicLink, ETableShell } from "@/components/v2/admin/estate-kit";

type Holding = { heldStockId: string; item: { id: string; name: string; unit: string } | null; quantity: number };
type HolderGroup = {
  holder: { id: string; name: string | null; email: string; role: string } | null;
  items: Holding[];
};

function roleLabel(role?: string) {
  if (role === "QA_INSPECTOR") return "QA";
  if (role === "OPS_MANAGER") return "Ops";
  if (!role) return "";
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function EstateOnHand() {
  const [byHolder, setByHolder] = useState<HolderGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/inventory/held-stock");
        const body = await res.json().catch(() => ({}));
        if (res.ok) setByHolder(Array.isArray(body.byHolder) ? body.byHolder : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const totals = useMemo(
    () => ({
      holders: byHolder.filter((g) => g.items.length > 0).length,
      units: byHolder.reduce((s, g) => s + g.items.reduce((n, i) => n + i.quantity, 0), 0),
    }),
    [byHolder],
  );

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-4 sm:max-w-md">
        <EStatCard label="Holders with stock" value={totals.holders} icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="Units on hand" value={totals.units} icon={<PackageCheck className="h-4 w-4" />} />
      </section>

      {loading ? (
        <ECard className="p-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</ECard>
      ) : byHolder.filter((g) => g.items.length > 0).length === 0 ? (
        <ECard className="p-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          No stock is currently held by anyone.
        </ECard>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {byHolder
            .filter((g) => g.items.length > 0)
            .map((group, idx) => (
              <ECard key={group.holder?.id ?? idx} className="overflow-hidden p-0">
                <div className="flex items-center gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3">
                  <EAvatar name={group.holder?.name ?? group.holder?.email ?? "?"} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-[550] text-[hsl(var(--e-foreground))]">
                      {group.holder?.name ?? group.holder?.email ?? "Unknown"}
                    </p>
                    {group.holder?.role ? (
                      <EBadge tone="neutral" soft>
                        {roleLabel(group.holder.role)}
                      </EBadge>
                    ) : null}
                  </div>
                </div>
                <ETableShell headers={[{ label: "Item" }, { label: "Qty", align: "right" }]}>
                  {group.items.map((h) => (
                    <tr key={h.heldStockId}>
                      <td className="px-4 py-2.5 text-[hsl(var(--e-foreground))]">
                        {h.item?.name ?? "Unknown item"}
                      </td>
                      <td className="px-4 py-2.5 text-right e-numeral text-[hsl(var(--e-foreground))]">
                        {h.quantity}
                        <span className="ml-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {h.item?.unit ?? ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </ETableShell>
              </ECard>
            ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Record new holdings &amp; deliver stock to a property in the classic inventory desk.
        </p>
        <EClassicLink href="/admin/inventory?tab=on-hand">Manage on-hand</EClassicLink>
      </div>
    </div>
  );
}
