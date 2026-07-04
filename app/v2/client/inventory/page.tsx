import Link from "next/link";
import { Role } from "@prisma/client";
import { Package } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";

export const metadata = { title: "Inventory · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientInventoryPage({
  searchParams,
}: {
  searchParams?: { propertyId?: string; lowOnly?: string; q?: string };
}) {
  await ensureClientModuleAccess("inventory");
  const session = await requireRole([Role.CLIENT]);
  await getAppSettings().catch(() => null);
  const user = await db.user
    .findUnique({
      where: { id: session.user.id },
      select: {
        clientId: true,
        client: {
          select: {
            id: true,
            name: true,
            properties: {
              where: { isActive: true },
              select: { id: true, name: true, suburb: true },
              orderBy: { name: "asc" },
            },
          },
        },
      },
    })
    .catch(() => null);

  const clientId = user?.clientId;
  const client = user?.client;
  const propertyIdRaw = searchParams?.propertyId?.trim();
  const propertyId =
    propertyIdRaw && client?.properties.some((p) => p.id === propertyIdRaw) ? propertyIdRaw : undefined;
  const lowOnly = searchParams?.lowOnly === "1";
  const q = (searchParams?.q ?? "").trim();

  const stocks = clientId
    ? await db.propertyStock
        .findMany({
          where: {
            property: { clientId, ...(propertyId ? { id: propertyId } : {}) },
            ...(q
              ? {
                  OR: [
                    { item: { name: { contains: q, mode: "insensitive" } } },
                    { item: { category: { contains: q, mode: "insensitive" } } },
                    { item: { location: { contains: q, mode: "insensitive" } } },
                    { property: { name: { contains: q, mode: "insensitive" } } },
                  ],
                }
              : {}),
          },
          include: {
            property: { select: { id: true, name: true, suburb: true } },
            item: { select: { id: true, name: true, category: true, location: true, unit: true, supplier: true } },
          },
          orderBy: [{ property: { name: "asc" } }, { item: { location: "asc" } }, { item: { category: "asc" } }, { item: { name: "asc" } }],
          take: 5000,
        })
        .catch(() => [])
    : [];

  const rows = lowOnly ? stocks.filter((s) => Number(s.onHand) <= Number(s.reorderThreshold)) : stocks;

  const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    const key = row.property.id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const totalLow = rows.filter((s) => Number(s.onHand) <= Number(s.reorderThreshold)).length;

  const inputClass =
    "w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Inventory"
        description="View stock levels for your properties."
        actions={
          <>
            <Link href="/v2/client/shopping"><EButton variant="outline" size="sm">Start shopping</EButton></Link>
            <Link href="/v2/client"><EButton variant="ghost" size="sm">Back to dashboard</EButton></Link>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Properties" value={String(client?.properties.length ?? 0)} delta="active" deltaTone="neutral" icon={<Package className="h-4 w-4" />} />
        <EStatCard label="Items shown" value={String(rows.length)} delta="matching filters" deltaTone="neutral" />
        <EStatCard label="Low stock items" value={String(totalLow)} delta="need reorder" deltaTone={totalLow ? "danger" : "neutral"} />
      </section>

      <ECard>
        <ECardHeader className="pb-3"><ECardTitle className="text-[0.95rem]">Filters</ECardTitle></ECardHeader>
        <ECardBody className="pt-0">
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label className="e-eyebrow">Property</label>
              <select name="propertyId" defaultValue={propertyId ?? ""} className={inputClass}>
                <option value="">All properties</option>
                {(client?.properties ?? []).map((property) => (
                  <option key={property.id} value={property.id}>{property.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="e-eyebrow">Search item / category / location</label>
              <input type="text" name="q" defaultValue={q} placeholder="e.g. toilet paper" className={inputClass} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                <input type="checkbox" name="lowOnly" value="1" defaultChecked={lowOnly} />
                Show low stock only
              </label>
            </div>
            <div className="flex items-end gap-2">
              <EButton type="submit" size="sm">Apply</EButton>
              <Link href="/v2/client/inventory"><EButton type="button" size="sm" variant="outline">Reset</EButton></Link>
            </div>
          </form>
        </ECardBody>
      </ECard>

      {rows.length === 0 ? (
        <EEmptyState eyebrow="Nothing here" title="No inventory items found" description="No inventory items match the selected filters." />
      ) : (
        <div className="space-y-4">
          {(client?.properties ?? [])
            .filter((property) => grouped[property.id]?.length)
            .map((property) => {
              const propertyRows = grouped[property.id] ?? [];
              return (
                <ECard key={property.id}>
                  <ECardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
                    <ECardTitle className="text-[0.95rem]">
                      {property.name} <span className="text-[0.8125rem] font-normal text-[hsl(var(--e-muted-foreground))]">({property.suburb})</span>
                    </ECardTitle>
                    <Link href={`/v2/client/shopping?propertyId=${property.id}`}><EButton size="sm" variant="outline">Start shopping</EButton></Link>
                  </ECardHeader>
                  <ECardBody className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-[0.8125rem]">
                        <thead>
                          <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                            {["Item", "Category", "Location", "Supplier", "On Hand", "Par", "Threshold", "Status"].map((h, i) => (
                              <th key={h} className={`px-4 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))] ${i >= 4 && i <= 6 ? "text-right" : ""}`}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {propertyRows.map((row) => {
                            const isLow = Number(row.onHand) <= Number(row.reorderThreshold);
                            return (
                              <tr key={row.id} className="border-t border-[hsl(var(--e-border)/0.7)]">
                                <td className="px-4 py-2">{row.item.name}</td>
                                <td className="px-4 py-2 text-[hsl(var(--e-muted-foreground))]">{row.item.category}</td>
                                <td className="px-4 py-2 text-[hsl(var(--e-muted-foreground))]">
                                  {row.item.location.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}
                                </td>
                                <td className="px-4 py-2 text-[hsl(var(--e-muted-foreground))]">{row.item.supplier ?? "-"}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{row.onHand} {row.item.unit}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{row.parLevel}</td>
                                <td className="px-4 py-2 text-right tabular-nums">{row.reorderThreshold}</td>
                                <td className="px-4 py-2">
                                  <EBadge tone={isLow ? "danger" : "neutral"} soft>{isLow ? "Low stock" : "OK"}</EBadge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </ECardBody>
                </ECard>
              );
            })}
        </div>
      )}
    </div>
  );
}
