import Link from "next/link";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Role } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function ClientInventoryPage({
  searchParams,
}: {
  searchParams?: { propertyId?: string; lowOnly?: string; q?: string };
}) {
  await ensureClientModuleAccess("inventory");
  const session = await requireRole([Role.CLIENT]);
  const appSettings = await getAppSettings();
  const user = await db.user.findUnique({
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
  });

  const clientId = user?.clientId;
  const client = user?.client;
  const propertyIdRaw = searchParams?.propertyId?.trim();
  const propertyId =
    propertyIdRaw && client?.properties.some((p) => p.id === propertyIdRaw) ? propertyIdRaw : undefined;
  const lowOnly = searchParams?.lowOnly === "1";
  const q = (searchParams?.q ?? "").trim();

  const stocks = clientId
    ? await db.propertyStock.findMany({
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
    : [];

  const rows = lowOnly
    ? stocks.filter((s) => Number(s.onHand) <= Number(s.reorderThreshold))
    : stocks;

  const grouped = rows.reduce<Record<string, typeof rows>>((acc, row) => {
    const key = row.property.id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const totalLow = rows.filter((s) => Number(s.onHand) <= Number(s.reorderThreshold)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            View stock levels for your properties.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/client/shopping">Start Shopping</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/client">Back to dashboard</Link>
          </Button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Properties</p>
            <p className="text-2xl font-bold">{client?.properties.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Items shown</p>
            <p className="text-2xl font-bold">{rows.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Low stock items</p>
            <p className="text-2xl font-bold">{totalLow}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Property</label>
              <select
                name="propertyId"
                defaultValue={propertyId ?? ""}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">All properties</option>
                {(client?.properties ?? []).map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Search item/category/location</label>
              <input
                type="text"
                name="q"
                defaultValue={q}
                placeholder="e.g. toilet paper"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="lowOnly" value="1" defaultChecked={lowOnly} />
                Show low stock only
              </label>
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm">Apply</Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href="/client/inventory">Reset</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No inventory items found for the selected filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {(client?.properties ?? [])
            .filter((property) => grouped[property.id]?.length)
            .map((property) => {
              const propertyRows = grouped[property.id] ?? [];
              return (
                <Card key={property.id}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {property.name} <span className="text-sm font-normal text-muted-foreground">({property.suburb})</span>
                      </CardTitle>
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/client/shopping?propertyId=${property.id}`}>Start shopping</Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30 text-left">
                            <th className="px-4 py-2 font-medium">Item</th>
                            <th className="px-4 py-2 font-medium">Category</th>
                            <th className="px-4 py-2 font-medium">Location</th>
                            <th className="px-4 py-2 font-medium">Supplier</th>
                            <th className="px-4 py-2 text-right font-medium">On Hand</th>
                            <th className="px-4 py-2 text-right font-medium">Par</th>
                            <th className="px-4 py-2 text-right font-medium">Threshold</th>
                            <th className="px-4 py-2 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {propertyRows.map((row) => {
                            const isLow = Number(row.onHand) <= Number(row.reorderThreshold);
                            return (
                              <tr key={row.id} className="border-b last:border-0">
                                <td className="px-4 py-2">{row.item.name}</td>
                                <td className="px-4 py-2 text-muted-foreground">{row.item.category}</td>
                                <td className="px-4 py-2 text-muted-foreground">
                                  {row.item.location
                                    .toLowerCase()
                                    .split("_")
                                    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                                    .join(" ")}
                                </td>
                                <td className="px-4 py-2 text-muted-foreground">{row.item.supplier ?? "-"}</td>
                                <td className="px-4 py-2 text-right">
                                  {row.onHand} {row.item.unit}
                                </td>
                                <td className="px-4 py-2 text-right">{row.parLevel}</td>
                                <td className="px-4 py-2 text-right">{row.reorderThreshold}</td>
                                <td className="px-4 py-2">
                                  <span
                                    className={`inline-flex rounded-full border px-2 py-1 text-xs ${
                                      isLow
                                        ? "border-destructive/40 bg-destructive/5 text-destructive"
                                        : "border-border text-muted-foreground"
                                    }`}
                                  >
                                    {isLow ? "Low stock" : "OK"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}
    </div>
  );
}
