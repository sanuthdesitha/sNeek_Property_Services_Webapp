import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Plus } from "lucide-react";

export default function CleanerLostFoundPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Lost & Found</h1>
          <p className="text-text-secondary mt-1">Report items found during cleaning</p>
        </div>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Report a Found Item</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <Input label="Property" placeholder="Select property" />
            <Input label="Item Description" placeholder="Describe the found item" />
            <Input label="Location Found" placeholder="e.g., Under the bed in bedroom 2" leftIcon={<MapPin className="h-4 w-4" />} />
            <Textarea label="Additional Notes" placeholder="Any additional details..." />
            <Button type="submit"><Plus className="h-4 w-4 mr-2" />Report Item</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Reported Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { item: "Silver necklace", property: "Harbour View Apt", location: "Under bed, bedroom 2", date: "Apr 14", status: "RETURNED" },
              { item: "Phone charger", property: "Beach House", location: "Kitchen counter", date: "Apr 13", status: "PENDING" },
            ].map((found, i) => (
              <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{found.item}</p>
                    <p className="text-xs text-text-tertiary">{found.property} &middot; {found.location}</p>
                  </div>
                  <Badge variant={found.status === "RETURNED" ? "success" : "warning"}>{found.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
