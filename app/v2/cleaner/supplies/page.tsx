import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listHeldStock } from "@/lib/inventory/held-stock";
import {
  EBadge,
  ECard,
  ECardBody,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Supplies · Estate cleaner" };
export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function qtyTone(qty: number): Tone {
  if (qty <= 0) return "danger";
  if (qty <= 2) return "warning";
  return "success";
}

/**
 * Stock this cleaner is currently holding (bought/shopped but not yet dropped at
 * a unit) — the same on-hand ledger the live cleaner shopping page shows, scoped
 * to the session user via holderUserId.
 */
async function getMyOnHand(userId: string) {
  return listHeldStock({ holderUserId: userId }).catch(() => []);
}

export default async function CleanerSuppliesPage() {
  const session = await requireRole([Role.CLEANER]);
  const holdings = await getMyOnHand(session.user.id);

  // Aggregate per catalog item (a cleaner can hold the same item across several
  // shopping runs) so the list reads as one line per product.
  const byItem = new Map<string, { name: string; unit: string | null; quantity: number }>();
  for (const row of holdings) {
    const key = row.item.id;
    const existing = byItem.get(key);
    if (existing) {
      existing.quantity += row.quantity;
    } else {
      byItem.set(key, { name: row.item.name, unit: row.item.unit, quantity: row.quantity });
    }
  }
  const items = Array.from(byItem.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Inventory"
        title="Supplies"
        description="Stock you're holding that hasn't been dropped at a unit yet."
      />

      {items.length === 0 ? (
        <EEmptyState
          eyebrow="Empty hands"
          title="No stock on hand"
          description="Items you buy on a shopping run appear here until you deliver them to a unit."
        />
      ) : (
        <ECard>
          <ECardBody className="pt-6">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {items.map((s) => {
                const unit = s.unit ? ` ${s.unit}` : "";
                const label = s.quantity <= 0 ? "Out" : `${s.quantity}${unit} on hand`;
                return (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <p className="text-[0.875rem] font-medium">{s.name}</p>
                    <EBadge tone={qtyTone(s.quantity)} soft>
                      {label}
                    </EBadge>
                  </div>
                );
              })}
            </div>
          </ECardBody>
        </ECard>
      )}
    </div>
  );
}
