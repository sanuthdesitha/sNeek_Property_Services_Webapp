"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Mail, Phone, Calendar, MessageSquare, Receipt, Search, LayoutGrid, List } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ClientHubRow {
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

/**
 * Clients tab body for the Accounts hub. Mirrors the data + auth of the old
 * /admin/clients page (cards + table views) but links each client to its new
 * rich summary page at /admin/accounts/clients/[id], plus adds a quick search.
 */
export function ClientsHubList({ clients }: { clients: ClientHubRow[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q),
    );
  }, [clients, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients..."
            className="pl-9"
          />
        </div>
        <div className="inline-flex items-center gap-1 self-start rounded-lg border border-border bg-surface-raised p-1">
          <button
            type="button"
            onClick={() => setView("cards")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
              view === "cards" ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            <LayoutGrid className="h-4 w-4" /> Cards
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
              view === "table" ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            <List className="h-4 w-4" /> Table
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          {query ? (
            "No clients match your search."
          ) : (
            <>
              No clients yet.{" "}
              <Link href="/admin/clients/new" className="text-primary hover:underline">
                Add your first client →
              </Link>
            </>
          )}
        </div>
      ) : view === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => (
            <Card key={client.id} className="rounded-2xl transition-colors hover:border-primary/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/accounts/clients/${client.id}`}
                      className="text-base font-medium hover:underline"
                    >
                      <span className="block truncate">{client.name}</span>
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      {client.email && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          <span className="max-w-[12rem] truncate">{client.email}</span>
                        </span>
                      )}
                      {client.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {client.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    <Building2 className="mr-1 h-3 w-3" />
                    {client.propertiesCount}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Calendar className="h-3 w-3" /> Active jobs
                    </div>
                    <div className="mt-0.5 text-sm font-medium tabular-nums">{client.activeJobsCount}</div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Receipt className="h-3 w-3" /> Last invoice
                    </div>
                    <div className="mt-0.5 text-sm font-medium tabular-nums">
                      {client.lastInvoiceAmount !== null ? fmtCurrency.format(client.lastInvoiceAmount) : "—"}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link href={`/admin/accounts/clients/${client.id}`}>View</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link href={`/admin/messages/compose?recipient=${client.id}`}>
                      <MessageSquare className="mr-1 h-3 w-3" /> Message
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            <div className="divide-y">
              {filtered.map((client) => (
                <Link
                  key={client.id}
                  href={`/admin/accounts/clients/${client.id}`}
                  className="flex items-center justify-between px-6 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge variant="outline" className="shrink-0">
                      <Building2 className="mr-1 h-3 w-3" />
                      {client.propertiesCount}
                    </Badge>
                    <span className="truncate font-medium">{client.name}</span>
                  </div>
                  <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
                    {client.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {client.email}
                      </span>
                    )}
                    {client.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {client.phone}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
