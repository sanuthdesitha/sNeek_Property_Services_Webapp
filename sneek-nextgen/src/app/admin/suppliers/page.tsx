import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Truck, Mail, Phone } from "lucide-react";

export default function SuppliersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Suppliers</h1>
          <p className="text-text-secondary mt-1">Manage supply vendors and contacts</p>
        </div>
        <Button asChild>
          <Link href="/admin/suppliers/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Supplier
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Suppliers</CardTitle>
          <CardDescription>Supply vendors</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "CleanCo Supplies", email: "orders@cleanco.com", phone: "+61400000010", category: "Chemicals & Equipment", active: true },
                { name: "PaperPlus", email: "sales@paperplus.com", phone: "+61400000011", category: "Consumables", active: true },
                { name: "Sydney Fresh Laundry Co", email: "orders@sydneyfreshlaundry.com", phone: "+61400000010", category: "Laundry", active: true },
              ].map((supplier, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm flex items-center gap-2">
                    <Truck className="h-4 w-4 text-text-tertiary" />
                    {supplier.name}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-xs flex items-center gap-1 text-text-secondary"><Mail className="h-3 w-3" />{supplier.email}</p>
                      <p className="text-xs flex items-center gap-1 text-text-secondary"><Phone className="h-3 w-3" />{supplier.phone}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{supplier.category}</TableCell>
                  <TableCell>{supplier.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</TableCell>
                  <TableCell><Button variant="ghost" size="sm">Edit</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
