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
import { Plus, Search, FileText, Download, Send, Eye } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral", label: "Draft" },
  APPROVED: { variant: "info", label: "Approved" },
  SENT: { variant: "warning", label: "Sent" },
  PAID: { variant: "success", label: "Paid" },
  VOID: { variant: "danger", label: "Void" },
};

export default function InvoicesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Invoices</h1>
          <p className="text-text-secondary mt-1">Manage client invoices</p>
        </div>
        <Button asChild>
          <Link href="/admin/invoices/new">
            <Plus className="h-4 w-4 mr-2" />
            Generate Invoice
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search invoices..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Invoices</CardTitle>
          <CardDescription>Client invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Subtotal</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { number: "INV-2026-4521", client: "Harbour Properties", period: "Apr 1-15", subtotal: 1090.91, gst: 109.09, total: 1200, status: "SENT" },
                { number: "INV-2026-4518", client: "Beach Rentals Co", period: "Apr 1-15", subtotal: 772.73, gst: 77.27, total: 850, status: "SENT" },
                { number: "INV-2026-4515", client: "City Apartments", period: "Mar 15-31", subtotal: 590.91, gst: 59.09, total: 650, status: "APPROVED" },
                { number: "INV-2026-4510", client: "Mountain Retreat", period: "Mar 1-15", subtotal: 454.55, gst: 45.45, total: 500, status: "PAID" },
              ].map((inv) => {
                const config = STATUS_CONFIG[inv.status];
                return (
                  <TableRow key={inv.number}>
                    <TableCell className="font-mono text-sm">{inv.number}</TableCell>
                    <TableCell className="text-sm">{inv.client}</TableCell>
                    <TableCell className="text-sm">{inv.period}</TableCell>
                    <TableCell className="text-sm">${inv.subtotal.toFixed(2)}</TableCell>
                    <TableCell className="text-sm">${inv.gst.toFixed(2)}</TableCell>
                    <TableCell className="font-medium">${inv.total.toFixed(2)}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                        {inv.status === "APPROVED" && <Button variant="ghost" size="sm"><Send className="h-4 w-4" /></Button>}
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
