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

export default function PropertiesPage() {
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
          <CardDescription>2 properties registered</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>iCal</TableHead>
                <TableHead>Laundry</TableHead>
                <TableHead>Inventory</TableHead>
                <TableHead>Jobs</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { name: "Harbour View Apartment", address: "123 Harbour St, Sydney", client: "Harbour Properties", beds: 2, baths: 1, balcony: true, ical: true, laundry: true, inventory: true, jobs: 24 },
                { name: "Beach House", address: "45 Ocean Ave, Bondi", client: "Harbour Properties", beds: 3, baths: 2, balcony: false, ical: false, laundry: true, inventory: true, jobs: 12 },
              ].map((prop) => (
                <TableRow key={prop.name}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{prop.name}</p>
                      <p className="text-xs text-text-tertiary flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {prop.address}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{prop.client}</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-2">
                      <Home className="h-3 w-3 text-text-tertiary" />
                      {prop.beds} bed / {prop.baths} bath
                      {prop.balcony && <Badge variant="info" className="text-xs">Balcony</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {prop.ical ? <Badge variant="success">Connected</Badge> : <Badge variant="neutral">Not set</Badge>}
                  </TableCell>
                  <TableCell>
                    {prop.laundry ? <Badge variant="success"><Shirt className="h-3 w-3 mr-1" />Enabled</Badge> : <Badge variant="neutral">Disabled</Badge>}
                  </TableCell>
                  <TableCell>
                    {prop.inventory ? <Badge variant="success">Enabled</Badge> : <Badge variant="neutral">Disabled</Badge>}
                  </TableCell>
                  <TableCell className="text-sm flex items-center gap-1">
                    <Briefcase className="h-3 w-3 text-text-tertiary" />
                    {prop.jobs}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/admin/properties/${prop.name.toLowerCase().replace(/\s+/g, "-")}`}>View</Link>
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
