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
import { Plus, Search, AlertTriangle, Package, TrendingDown } from "lucide-react";

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Inventory</h1>
          <p className="text-text-secondary mt-1">Manage stock levels and supplies</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/inventory/import">Import</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/inventory/export">Export</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/inventory/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Item
            </Link>
          </Button>
        </div>
      </div>

      {/* Stock alerts */}
      <Card variant="outlined" className="border-warning-200 bg-warning-50 dark:bg-warning-900/10">
        <CardContent className="pt-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning-600" />
            <div>
              <p className="font-medium text-warning-800 dark:text-warning-300">Low Stock Alerts</p>
              <p className="text-sm text-warning-700 dark:text-warning-400">3 items are below their reorder threshold</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Inventory table */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Inventory Items</CardTitle>
          <CardDescription>10 items in catalog</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input placeholder="Search items..." leftIcon={<Search className="h-4 w-4" />} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "All-Purpose Cleaner", sku: "APC-001", category: "CHEMICALS", unit: "bottle", supplier: "CleanCo", low: false },
                { name: "Glass Cleaner", sku: "GC-001", category: "CHEMICALS", unit: "bottle", supplier: "CleanCo", low: true },
                { name: "Bathroom Disinfectant", sku: "BD-001", category: "CHEMICALS", unit: "bottle", supplier: "CleanCo", low: false },
                { name: "Microfiber Cloths", sku: "MC-001", category: "CLOTHS", unit: "pack", supplier: null, low: false },
                { name: "Toilet Paper (Roll)", sku: "TP-001", category: "CONSUMABLES", unit: "roll", supplier: "PaperPlus", low: true },
                { name: "Hand Soap (500ml)", sku: "HS-001", category: "CONSUMABLES", unit: "bottle", supplier: "PaperPlus", low: true },
              ].map((item) => (
                <TableRow key={item.sku}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-text-tertiary" />
                      <span className="font-medium text-sm">{item.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                  <TableCell className="text-sm">{item.category}</TableCell>
                  <TableCell className="text-sm">{item.unit}</TableCell>
                  <TableCell className="text-sm">{item.supplier ?? "—"}</TableCell>
                  <TableCell>
                    {item.low ? (
                      <Badge variant="danger">
                        <TrendingDown className="h-3 w-3 mr-1" />
                        Low Stock
                      </Badge>
                    ) : (
                      <Badge variant="success">In Stock</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">Edit</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
