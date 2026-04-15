import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Home, MapPin, Bed, Bath, Shirt, Package } from "lucide-react";

export default function ClientPropertiesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Properties</h1>
        <p className="text-text-secondary mt-1">Manage your property details</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { name: "Harbour View Apartment", address: "123 Harbour St, Sydney", beds: 2, baths: 1, balcony: true, laundry: true, inventory: true, jobs: 24 },
          { name: "Beach House", address: "45 Ocean Ave, Bondi", beds: 3, baths: 2, balcony: false, laundry: true, inventory: true, jobs: 12 },
        ].map((prop) => (
          <Card key={prop.name} variant="outlined">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Home className="h-5 w-5 text-brand-600" />
                <CardTitle className="text-base">{prop.name}</CardTitle>
              </div>
              <CardDescription className="flex items-center gap-1"><MapPin className="h-3 w-3" />{prop.address}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex items-center gap-2"><Bed className="h-4 w-4 text-text-tertiary" />{prop.beds} Bedrooms</div>
                <div className="flex items-center gap-2"><Bath className="h-4 w-4 text-text-tertiary" />{prop.baths} Bathrooms</div>
                <div className="flex items-center gap-2"><Shirt className="h-4 w-4 text-text-tertiary" />Laundry {prop.laundry ? "Enabled" : "Disabled"}</div>
                <div className="flex items-center gap-2"><Package className="h-4 w-4 text-text-tertiary" />Inventory {prop.inventory ? "Enabled" : "Disabled"}</div>
              </div>
              <div className="flex items-center gap-2 mt-4">
                <Button variant="outline" size="sm" asChild><Link href={`/client/properties/${prop.name.toLowerCase().replace(/\s+/g, "-")}`}>View Details</Link></Button>
                <Badge variant="neutral">{prop.jobs} jobs</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
