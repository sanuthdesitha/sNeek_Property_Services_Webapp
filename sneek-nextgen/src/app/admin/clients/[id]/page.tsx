import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Mail, Phone, Home, FileText, Briefcase, MessageSquare } from "lucide-react";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild><Link href="/admin/clients"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Harbour Properties Pty Ltd</h1>
            <p className="text-text-secondary mt-1">Client since 2024</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild><Link href="/admin/clients/edit">Edit</Link></Button>
          <Button variant="outline">Invite to Portal</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Home className="h-4 w-4" />Properties</div>
            <p className="text-lg font-semibold mt-1">2</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><Briefcase className="h-4 w-4" />Total Jobs</div>
            <p className="text-lg font-semibold mt-1">36</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><FileText className="h-4 w-4" />Invoices</div>
            <p className="text-lg font-semibold mt-1">8</p>
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary"><MessageSquare className="h-4 w-4" />Cases</div>
            <p className="text-lg font-semibold mt-1">1</p>
          </CardContent>
        </Card>
      </div>

      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-text-tertiary" />sarah@harbourproperties.com.au</div>
            <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-text-tertiary" />+61400000004</div>
          </div>
          <Separator className="my-4" />
          <p className="text-sm text-text-secondary">Primary client - multiple properties. Prefers email communication.</p>
        </CardContent>
      </Card>

      <Tabs defaultValue="properties">
        <TabsList>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="properties" className="space-y-3">
          {[
            { id: "prop_001", name: "Harbour View Apartment", address: "123 Harbour St, Sydney", jobs: 24 },
            { id: "prop_002", name: "Beach House", address: "45 Ocean Ave, Bondi", jobs: 12 },
          ].map((prop) => (
            <div key={prop.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
              <div>
                <p className="text-sm font-medium">{prop.name}</p>
                <p className="text-xs text-text-tertiary">{prop.address} &middot; {prop.jobs} jobs</p>
              </div>
              <Button variant="ghost" size="sm" asChild><Link href={`/admin/properties/${prop.id}`}>View</Link></Button>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="jobs" className="space-y-3">
          {[
            { id: "SNK-ABC123", property: "Harbour View Apt", type: "Airbnb Turnover", date: "Apr 15", status: "COMPLETED" },
            { id: "SNK-DEF456", property: "Beach House", type: "Deep Clean", date: "Apr 14", status: "COMPLETED" },
          ].map((job) => (
            <div key={job.id} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
              <div>
                <p className="text-sm font-medium">{job.type}</p>
                <p className="text-xs text-text-tertiary">{job.property} &middot; {job.date}</p>
              </div>
              <Badge variant="success">{job.status}</Badge>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="invoices" className="space-y-3">
          {[
            { number: "INV-2026-4521", period: "Apr 1-15", total: 1200, status: "SENT" },
            { number: "INV-2026-4510", period: "Mar 1-15", total: 650, status: "PAID" },
          ].map((inv) => (
            <div key={inv.number} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
              <div>
                <p className="text-sm font-medium">{inv.number}</p>
                <p className="text-xs text-text-tertiary">{inv.period}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">${inv.total}</p>
                <Badge variant={inv.status === "PAID" ? "success" : "warning"}>{inv.status}</Badge>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="messages" className="space-y-3">
          <p className="text-sm text-text-secondary">No messages yet.</p>
        </TabsContent>

        <TabsContent value="activity" className="space-y-3">
          {[
            { action: "Job completed", detail: "SNK-ABC123 — Airbnb Turnover", time: "5 min ago" },
            { action: "Invoice sent", detail: "INV-2026-4521 — $1,200", time: "1 hour ago" },
            { action: "Property added", detail: "Beach House", time: "2 weeks ago" },
          ].map((item, i) => (
            <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
              <div>
                <p className="text-sm font-medium">{item.action}</p>
                <p className="text-xs text-text-tertiary">{item.detail}</p>
              </div>
              <span className="text-xs text-text-tertiary">{item.time}</span>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
