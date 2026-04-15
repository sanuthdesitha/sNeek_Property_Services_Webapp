import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shirt, Calendar, Truck, AlertTriangle, CheckCircle, Clock } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; label: string }> = {
  PENDING: { variant: "neutral", label: "Pending" },
  CONFIRMED: { variant: "info", label: "Confirmed" },
  PICKED_UP: { variant: "warning", label: "Picked Up" },
  DROPPED: { variant: "success", label: "Dropped Off" },
  FLAGGED: { variant: "danger", label: "Flagged" },
  SKIPPED_PICKUP: { variant: "neutral", label: "Skipped" },
};

export default function LaundryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Laundry</h1>
          <p className="text-text-secondary mt-1">Manage laundry tasks and suppliers</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/laundry/suppliers">
              <Truck className="h-4 w-4 mr-2" />
              Suppliers
            </Link>
          </Button>
          <Button variant="outline">
            <Calendar className="h-4 w-4 mr-2" />
            Calendar
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: "Pending", count: 3, icon: Clock, color: "neutral" as const },
          { label: "Confirmed", count: 2, icon: CheckCircle, color: "info" as const },
          { label: "Picked Up", count: 1, icon: Truck, color: "warning" as const },
          { label: "Flagged", count: 1, icon: AlertTriangle, color: "danger" as const },
        ].map((stat) => (
          <Card key={stat.label} variant="outlined">
            <div className="flex items-center gap-3 p-4">
              <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <stat.icon className="h-5 w-5 text-text-secondary" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">{stat.label}</p>
                <p className="text-2xl font-bold">{stat.count}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Tasks */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Laundry Tasks</CardTitle>
          <CardDescription>All laundry tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Pickup Date</TableHead>
                <TableHead>Dropoff Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Bags</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { property: "Harbour View Apt", pickup: "2026-04-15", dropoff: "2026-04-17", status: "PENDING", bags: 2, supplier: "Sydney Fresh Laundry" },
                { property: "Beach House", pickup: "2026-04-15", dropoff: "2026-04-17", status: "CONFIRMED", bags: 3, supplier: "Sydney Fresh Laundry" },
                { property: "City Studio", pickup: "2026-04-14", dropoff: "2026-04-16", status: "PICKED_UP", bags: 1, supplier: null },
                { property: "Mountain Retreat", pickup: "2026-04-14", dropoff: "2026-04-16", status: "FLAGGED", bags: 4, supplier: "Sydney Fresh Laundry" },
              ].map((task, i) => {
                const config = STATUS_CONFIG[task.status];
                return (
                  <TableRow key={i}>
                    <TableCell className="font-medium text-sm">{task.property}</TableCell>
                    <TableCell className="text-sm">{task.pickup}</TableCell>
                    <TableCell className="text-sm">{task.dropoff}</TableCell>
                    <TableCell><Badge variant={config.variant}>{config.label}</Badge></TableCell>
                    <TableCell className="text-sm">{task.bags} bags</TableCell>
                    <TableCell className="text-sm">{task.supplier ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm">View</Button>
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
