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
import { prisma } from "@/lib/db/prisma";

async function getClients() {
  const clients = await prisma.client.findMany({
    include: {
      _count: { select: { properties: true, invoices: true } },
    },
    orderBy: { name: "asc" },
  });
  return clients;
}

export default async function ClientsPage() {
  const clients = await getClients();

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
          <CardDescription>{clients.length} clients registered</CardDescription>
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
              {clients.length > 0 ? clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <p className="font-medium text-sm">{client.name}</p>
                  </td>
                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="text-xs flex items-center gap-1 text-text-secondary">
                        <Mail className="h-3 w-3" />
                        {client.email ?? "—"}
                      </p>
                      <p className="text-xs flex items-center gap-1 text-text-secondary">
                        <Phone className="h-3 w-3" />
                        {client.phone ?? "—"}
                      </p>
                    </div>
                  </td>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Home className="h-3 w-3 text-text-tertiary" />
                    {client._count.properties}
                  </td>
                  <TableCell className="text-sm flex items-center gap-1">
                    <FileText className="h-3 w-3 text-text-tertiary" />
                    {client._count.invoices}
                  </td>
                  <TableCell>
                    {client.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}
                  </td>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/clients/${client.id}`}>View</Link>
                    </Button>
                  </td>
                </TableRow>
              )) : (
                <TableRow>
                  <td colSpan={8} className="text-center text-text-tertiary py-8">No clients found</td>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
