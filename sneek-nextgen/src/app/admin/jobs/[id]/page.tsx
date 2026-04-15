import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, MapPin, Clock, User, Calendar, FileText, Camera, CheckCircle2, AlertTriangle } from "lucide-react";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link href="/admin/jobs"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-text-primary">Job {id}</h1>
              <Badge variant="warning">ASSIGNED</Badge>
            </div>
            <p className="text-text-secondary mt-1">Airbnb Turnover &middot; Harbour View Apartment</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline">Reschedule</Button>
          <Button>Assign Cleaner</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Calendar className="h-4 w-4" />
              <span>Scheduled</span>
            </div>
            <p className="text-lg font-semibold mt-1">Apr 16, 2026</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Clock className="h-4 w-4" />
              <span>Est. Hours</span>
            </div>
            <p className="text-lg font-semibold mt-1">3.0 hrs</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <User className="h-4 w-4" />
              <span>Cleaner</span>
            </div>
            <p className="text-lg font-semibold mt-1">John C.</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <MapPin className="h-4 w-4" />
              <span>Property</span>
            </div>
            <p className="text-lg font-semibold mt-1">Harbour View</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="qa">QA Review</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Job Information</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-text-tertiary">Job Number:</span> <span className="font-mono ml-2">SNK-ABC123</span></div>
                <div><span className="text-text-tertiary">Type:</span> <span className="ml-2">Airbnb Turnover</span></div>
                <div><span className="text-text-tertiary">Status:</span> <span className="ml-2">ASSIGNED</span></div>
                <div><span className="text-text-tertiary">Priority:</span> <span className="ml-2">Normal (4)</span></div>
                <div><span className="text-text-tertiary">Check-in:</span> <span className="ml-2">14:00</span></div>
                <div><span className="text-text-tertiary">Check-out:</span> <span className="ml-2">10:00</span></div>
                <div><span className="text-text-tertiary">Same-day:</span> <span className="ml-2">No</span></div>
                <div><span className="text-text-tertiary">Safety Checkin:</span> <span className="ml-2">Required</span></div>
              </div>
              <Separator className="my-4" />
              <div>
                <p className="text-sm font-medium mb-1">Notes</p>
                <p className="text-sm text-text-secondary">Regular turnover. Guest arrives at 2pm.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Job Timeline</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { time: "Apr 15, 9:00 AM", event: "Job created", user: "Admin User" },
                  { time: "Apr 15, 9:05 AM", event: "Assigned to John C.", user: "Admin User" },
                  { time: "Apr 15, 9:10 AM", event: "Assignment accepted", user: "John C." },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-brand-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium">{item.event}</p>
                      <p className="text-xs text-text-tertiary">{item.time} &middot; {item.user}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Job Tasks</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { title: "Clean oven interior", status: "COMPLETED", requiresPhoto: true },
                  { title: "Restock toiletries", status: "OPEN", requiresPhoto: false },
                  { title: "Check for lost items", status: "OPEN", requiresPhoto: false },
                ].map((task, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                    <div className="flex items-center gap-3">
                      {task.status === "COMPLETED" ? <CheckCircle2 className="h-4 w-4 text-success-600" /> : <AlertTriangle className="h-4 w-4 text-text-tertiary" />}
                      <div>
                        <p className="text-sm font-medium">{task.title}</p>
                        {task.requiresPhoto && <p className="text-xs text-text-tertiary">Photo required</p>}
                      </div>
                    </div>
                    <Badge variant={task.status === "COMPLETED" ? "success" : "neutral"}>{task.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="photos" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">Photos</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="aspect-square rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                    <Camera className="h-6 w-6 text-text-tertiary" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="qa" className="space-y-4">
          <Card variant="outlined">
            <CardHeader><CardTitle className="text-base">QA Review</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">QA review will be available after job submission.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
