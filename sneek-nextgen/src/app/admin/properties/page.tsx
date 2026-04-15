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
import { Plus, Search, MapPin, Home, Shirt, Briefcase } from "lucide-react";
import { prisma } from "@/lib/db/prisma";

async function getProperties() {
  const properties = await prisma.property.findMany({
    include: {
      client: { select: { name: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: { name: "asc" },
  });
  return properties;
}

export default async function PropertiesPage() {
  const properties = await getProperties();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Properties</h1>
          <p className="text-text-secondary mt-1">Manage all client properties</p>
        </div>
        <Button asChild>
          <Link href="/admin/properties/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Property
          </Link>
        </Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-48">
              <Input placeholder="Search properties..." leftIcon={<Search className="h-4 w-4" />} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">All Properties</CardTitle>
          <CardDescription>{properties.length} properties registered</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Laundry</TableHead>
                <TableHead>Inventory</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties.length > 0 ? properties.map((prop) => (
                <TableRow key={prop.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{prop.name}</p>
                      <p className="text-xs text-text-tertiary flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {prop.address}, {prop.suburb}
                      </p>
                    </div>
                  </td>
                  <TableCell className="text-sm">{prop.client?.name ?? "—"}</td>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-2">
                      <Home className="h-3 w-3 text-text-tertiary" />
                      {prop.bedrooms} bed / {prop.bathrooms} bath
                      {prop.hasBalcony && <Badge variant="info" className="text-xs">Balcony</Badge>}
                    </div>
                  </td>
                  <TableCell>
                    {prop.laundryEnabled ? <Badge variant="success"><Shirt className="h-3 w-3 mr-1" />Enabled</Badge> : <Badge variant="neutral">Disabled</Badge>}
                  </td>
                  <TableCell>
                    {prop.inventoryEnabled ? <Badge variant="success">Enabled</Badge> : <Badge variant="neutral">Disabled</Badge>}
                  </td>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Briefcase className="h-3 w-3 text-text-tertiary" />
                    {prop._count.jobs}
                  </td>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/properties/${prop.id}`}>View</Link>
                    </Button>
                  </td>
                </TableRow>
              )) : (
                <TableRow>
                  <td colSpan={8} className="text-center text-text-tertiary py-8">No properties found</td>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
