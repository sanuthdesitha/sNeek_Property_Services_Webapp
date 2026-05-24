"use client";

import Link from "next/link";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Mail, Phone, Calendar, MessageSquare, Receipt } from "lucide-react";

export interface ClientCardStats {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  propertiesCount: number;
  activeJobsCount: number;
  lastInvoiceAmount: number | null;
  lastInvoiceAt: string | null;
}

export function ClientsCardsGrid({ clients }: { clients: ClientCardStats[] }) {
  if (clients.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        No clients yet.{" "}
        <Link href="/admin/clients/new" className="text-primary hover:underline">
          Add your first client →
        </Link>
      </div>
    );
  }

  const fmt = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {clients.map((client) => (
        <Card key={client.id} className="hover:border-primary/50 transition-colors">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/admin/clients/${client.id}`}
                  className="text-base font-medium hover:underline"
                >
                  <span className="truncate block">{client.name}</span>
                </Link>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  {client.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      <span className="truncate max-w-[12rem]">{client.email}</span>
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
                <Building2 className="h-3 w-3 mr-1" />
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
                <div className="mt-0.5 text-sm font-medium">{client.activeJobsCount}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Receipt className="h-3 w-3" /> Last invoice
                </div>
                <div className="mt-0.5 text-sm font-medium">
                  {client.lastInvoiceAmount !== null
                    ? fmt.format(client.lastInvoiceAmount)
                    : "—"}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href={`/admin/clients/${client.id}`}>View</Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="flex-1">
                <Link href={`/admin/messages/compose?recipient=${client.id}`}>
                  <MessageSquare className="h-3 w-3 mr-1" /> Message
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
