"use client";

/**
 * ESTATE clients tab — v2-native replacement for the v1 ClientsHubList.
 * Read-only rows (same server data), each linking to the Estate client page
 * at /v2/admin/clients/[id].
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Mail, Phone, Search } from "lucide-react";
import { EBadge, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EAvatar, EInput } from "@/components/v2/admin/estate-kit";

export interface EstateClientRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  propertiesCount: number;
  activeJobsCount: number;
  lastInvoiceAmount: number | null;
  lastInvoiceAt: string | null;
}

const fmtCurrency = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

export function EstateClientsList({ clients }: { clients: EstateClientRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q)
    );
  }, [clients, query]);

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
        <EInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EEmptyState
          eyebrow="Clients"
          title={query ? "No matches" : "No clients yet"}
          description={
            query
              ? "No clients match your search."
              : "Add your first client to begin building the portfolio."
          }
        />
      ) : (
        <ECard>
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {filtered.map((client) => (
              <Link
                key={client.id}
                href={`/v2/admin/clients/${client.id}`}
                className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-[160ms] hover:bg-[hsl(var(--e-muted))]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <EAvatar name={client.name} />
                  <div className="min-w-0">
                    <p className="truncate text-[0.9375rem] font-[550] group-hover:text-[hsl(var(--e-gold-ink))]">
                      {client.name}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {client.email ? (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          <span className="max-w-[14rem] truncate">{client.email}</span>
                        </span>
                      ) : null}
                      {client.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {client.phone}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <EBadge tone="primary" soft>
                    <Building2 className="h-3 w-3" />
                    {client.propertiesCount}
                  </EBadge>
                  <div className="hidden text-right sm:block">
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--e-text-faint))]">
                      Active jobs
                    </p>
                    <p className="e-numeral text-[0.9375rem]">{client.activeJobsCount}</p>
                  </div>
                  <div className="hidden text-right md:block">
                    <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--e-text-faint))]">
                      Last invoice
                    </p>
                    <p className="e-numeral text-[0.9375rem]">
                      {client.lastInvoiceAmount !== null ? fmtCurrency.format(client.lastInvoiceAmount) : "—"}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-[hsl(var(--e-text-faint))] transition-transform duration-[160ms] group-hover:translate-x-0.5 group-hover:text-[hsl(var(--e-gold-ink))]" />
                </div>
              </Link>
            ))}
          </div>
        </ECard>
      )}
    </div>
  );
}
