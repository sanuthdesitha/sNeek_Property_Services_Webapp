import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, FileText, ArrowRight, Mail } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral", label: "Draft" },
  SENT: { variant: "info", label: "Sent" },
  ACCEPTED: { variant: "success", label: "Accepted" },
  DECLINED: { variant: "danger", label: "Declined" },
  CONVERTED: { variant: "success", label: "Converted" },
};

export default function QuotesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Quotes & Leads</h1>
          <p className="text-text-secondary mt-1">Manage quotes and track leads</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/quotes/leads">
              <Search className="h-4 w-4 mr-2" />
              Leads
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/quotes/new">
              <Plus className="h-4 w-4 mr-2" />
              New Quote
            </Link>
          </Button>
        </div>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Quotes</CardTitle>
          <CardDescription>Quotes and estimates</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Valid Until</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { id: "Q-001", client: "Harbour Properties", type: "Deep Clean", total: 320, status: "SENT", validUntil: "2026-05-01" },
                { id: "Q-002", client: "Beach Rentals Co", type: "Airbnb Turnover", total: 150, status: "DRAFT", validUntil: null },
                { id: "Q-003", client: "New Client", type: "End of Lease", total: 380, status: "ACCEPTED", validUntil: "2026-04-30" },
                { id: "Q-004", client: "City Apartments", type: "General Clean", total: 170, status: "CONVERTED", validUntil: "2026-04-20" },
              ].map((quote) => {
                const config = STATUS_CONFIG[quote.status];
                return (
                  <TableRow key={quote.id}>
                    <TableCell className="font-mono text-sm">{quote.id}</TableCell>
                    <TableCell className="text-sm">{quote.client}</TableCell>
                    <TableCell className="text-sm">{quote.type}</TableCell>
                    <TableCell className="font-medium">${quote.total}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell className="text-sm">{quote.validUntil ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/admin/quotes/${quote.id}`}>
                            <FileText className="h-4 w-4" />
                          </Link>
                        </Button>
                        {quote.status === "SENT" && (
                          <Button variant="ghost" size="sm"><Mail className="h-4 w-4" /></Button>
                        )}
                        {quote.status === "ACCEPTED" && (
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/admin/quotes/${quote.id}/convert`}>
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
