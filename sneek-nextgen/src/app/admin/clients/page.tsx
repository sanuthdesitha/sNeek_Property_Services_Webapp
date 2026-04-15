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
import { Plus, Search, Mail, Phone, Home, FileText } from "lucide-react";

export default function ClientsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Clients</h1>
          <p className="text-text-secondary mt-1">Manage all clients and their accounts</p>
        </div>
        <Button asChild>
          <Link href="/admin/clients/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Client
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search clients..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Clients</CardTitle>
          <CardDescription>1 client registered</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "Harbour Properties Pty Ltd", email: "sarah@harbourproperties.com.au", phone: "+61400000004", properties: 2, invoices: 8, active: true },
              ].map((client) => (
                <TableRow key={client.name}>
                  <TableCell>
                    <p className="font-medium text-sm">{client.name}</p>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-xs flex items-center gap-1 text-text-secondary">
                        <Mail className="h-3 w-3" />
                        {client.email}
                      </p>
                      <p className="text-xs flex items-center gap-1 text-text-secondary">
                        <Phone className="h-3 w-3" />
                        {client.phone}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Home className="h-3 w-3 text-text-tertiary" />
                    {client.properties}
                  </TableCell>
                  <TableCell className="text-sm flex items-center gap-1">
                    <FileText className="h-3 w-3 text-text-tertiary" />
                    {client.invoices}
                  </TableCell>
                  <TableCell>
                    {client.active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/clients/${client.name.toLowerCase().replace(/\s+/g, "-")}`}>View</Link>
                    </Button>
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
