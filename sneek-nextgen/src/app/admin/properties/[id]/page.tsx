import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, MapPin, Bed, Bath, Home, Shirt, Package, Plug, RefreshCw, CheckCircle2 } from "lucide-react";

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link href="/admin/properties"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Harbour View Apartment</h1>
            <p className="text-text-secondary mt-1 flex items-center gap-1"><MapPin className="h-4 w-4" />123 Harbour Street, Sydney NSW 2000</p>
          </div>
        </div>
        <Button asChild><Link href="/admin/properties/edit">Edit Property</Link></Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Bed className="h-4 w-4" />Bedrooms</div>
            <p className="text-lg font-semibold mt-1">2</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Bath className="h-4 w-4" />Bathrooms</div>
            <p className="text-lg font-semibold mt-1">1</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Shirt className="h-4 w-4" />Laundry</div>
            <p className="text-lg font-semibold mt-1">Enabled</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Package className="h-4 w-4" />Inventory</div>
            <p className="text-lg font-semibold mt-1">Enabled</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="integration">iCal Integration</TabsTrigger>
          <TabsTrigger value="form-overrides">Form Overrides</TabsTrigger>
          <TabsTrigger value="history">Job History</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Property Details</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-text-tertiary">Client:</span> <span className="ml-2">Harbour Properties Pty Ltd</span></div>
                <div><span className="text-text-tertiary">Preferred Cleaner:</span> <span className="ml-2">John C.</span></div>
                <div><span className="text-text-tertiary">Check-in:</span> <span className="ml-2">14:00</span></div>
                <div><span className="text-text-tertiary">Check-out:</span> <span className="ml-2">10:00</span></div>
                <div><span className="text-text-tertiary">Linen Buffer:</span> <span className="ml-2">3 sets</span></div>
                <div><span className="text-text-tertiary">Balcony:</span> <span className="ml-2">Yes</span></div>
                <div><span className="text-text-tertiary">Access Code:</span> <span className="ml-2 font-mono">1234</span></div>
                <div><span className="text-text-tertiary">Key Location:</span> <span className="ml-2">Lockbox at front door</span></div>
              </div>
              <Separator className="my-4" />
              <div>
                <p className="text-sm font-medium mb-1">Access Notes</p>
                <p className="text-sm text-text-secondary">Use side entrance, lockbox code 1234. Street parking available.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integration" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2"><Plug className="h-4 w-4" />iCal Integration</CardTitle>
                <Badge variant="success">Connected</Badge>
              </div>
              <CardDescription>Hospitable &middot; Last sync: Apr 15, 9:30 AM</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"><RefreshCw className="h-4 w-4 mr-1" />Sync Now</Button>
                <Button variant="outline" size="sm">View Sync History</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="form-overrides" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Form Template Overrides</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">No custom overrides configured for this property.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Job History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { id: "SNK-ABC123", type: "Airbnb Turnover", date: "Apr 15", status: "COMPLETED", qaScore: 92 },
                  { id: "SNK-DEF456", type: "Airbnb Turnover", date: "Apr 13", status: "COMPLETED", qaScore: 88 },
                  { id: "SNK-GHI789", type: "Deep Clean", date: "Apr 10", status: "COMPLETED", qaScore: 95 },
                ].map((job) => (
                  <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                    <div>
                      <p className="text-sm font-medium">{job.type}</p>
                      <p className="text-xs text-text-tertiary">{job.date} &middot; {job.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">{job.qaScore}% QA</Badge>
                      <Button variant="ghost" size="sm" asChild><Link href={`/admin/jobs/${job.id}`}>View</Link></Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
