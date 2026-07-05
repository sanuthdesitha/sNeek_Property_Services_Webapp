import Link from "next/link";
import { toZonedTime } from "date-fns-tz";
import { ClientInvoiceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { Plus, Search } from "lucide-react";

export const metadata = { title: "Clients · Estate admin" };
export const dynamic = "force-dynamic";

const TZ = "Australia/Sydney";

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-AU");
}

function initials(name: string): string {
  return (
    name
      .replace(/[^A-Za-z ]/g, "")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

async function getClients() {
  const nowSyd = toZonedTime(new Date(), TZ);
  const monthStart = new Date(nowSyd.getFullYear(), nowSyd.getMonth(), 1);

  const [clients, paidByClient] = await Promise.all([
    db.client
      .findMany({
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
        take: 25,
        select: {
          id: true,
          name: true,
          isActive: true,
          suburb: true,
          _count: { select: { properties: true } },
        },
      })
      .catch(() => []),
    db.clientInvoice
      .groupBy({
        by: ["clientId"],
        where: { status: ClientInvoiceStatus.PAID, createdAt: { gte: monthStart } },
        _sum: { totalAmount: true },
      })
      .catch(() => [] as { clientId: string; _sum: { totalAmount: number | null } }[]),
  ]);

  const mtdMap = new Map<string, number>();
  for (const row of paidByClient) mtdMap.set(row.clientId, row._sum.totalAmount ?? 0);

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    isActive: c.isActive,
    suburb: c.suburb,
    properties: c._count.properties,
    mtd: mtdMap.get(c.id) ?? 0,
  }));
}

export default async function AdminClientsPage() {
  const clients = await getClients();

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Clients"
        title="Client register"
        description="Every client, one canonical 360° record."
        actions={<EButton asChild variant="gold" size="sm"><Link href="/v2/admin/clients/new"><Plus className="h-3.5 w-3.5" /> New client</Link></EButton>}
      />

      <div className="flex h-9 items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Search className="h-4 w-4" /> Search clients…
      </div>

      <ECard>
        <ECardBody className="pt-6">
          {clients.length === 0 ? (
            <EEmptyState eyebrow="No clients yet" title="Your register is empty" description="Add a client to get started." />
          ) : (
            <div className="overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                    {["Client", "Properties", "Paid · MTD", "Status", ""].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.id} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]" style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}>
                            {initials(c.name)}
                          </span>
                          <div className="min-w-0">
                            <span className="font-[550]">{c.name}</span>
                            {c.suburb ? <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{c.suburb}</p> : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[hsl(var(--e-text-secondary))]">{c.properties}</td>
                      <td className="px-4 py-3"><span className="e-numeral text-[0.9375rem]">{money(c.mtd)}</span></td>
                      <td className="px-4 py-3">
                        <EBadge tone={c.isActive ? "primary" : "neutral"} soft>{c.isActive ? "Active" : "Inactive"}</EBadge>
                      </td>
                      <td className="px-4 py-3 text-right"><EButton asChild variant="ghost" size="sm"><Link href={`/v2/admin/clients/${c.id}`}>Open</Link></EButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ECardBody>
      </ECard>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · live data from your workspace.</p>
    </div>
  );
}
