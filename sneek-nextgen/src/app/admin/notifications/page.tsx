import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bell, Mail, Smartphone, Send } from "lucide-react";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Notifications</h1>
        <p className="text-text-secondary mt-1">Templates, preferences, and delivery logs</p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="logs">Delivery Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          {[
            { key: "invoice_sent", label: "Invoice Sent", category: "Invoice", channels: ["EMAIL"] },
            { key: "payroll_processed", label: "Payroll Processed", category: "Payroll", channels: ["EMAIL"] },
            { key: "job_assigned", label: "Job Assigned", category: "Job", channels: ["EMAIL", "PUSH"] },
            { key: "job_completed", label: "Job Completed", category: "Job", channels: ["EMAIL"] },
            { key: "stock_low", label: "Low Stock Alert", category: "Inventory", channels: ["EMAIL"] },
            { key: "laundry_ready", label: "Laundry Ready", category: "Laundry", channels: ["EMAIL"] },
            { key: "client_payment_received", label: "Payment Received", category: "Payment", channels: ["EMAIL"] },
            { key: "xero_export_success", label: "Xero Export Success", category: "Xero", channels: ["EMAIL"] },
          ].map((template) => (
            <Card key={template.key} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">{template.label}</h3>
                    <p className="text-xs text-text-tertiary">{template.key} &middot; {template.category}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {template.channels.map((ch) => (
                      <Badge key={ch} variant="neutral">
                        {ch === "EMAIL" && <Mail className="h-3 w-3 mr-1" />}
                        {ch === "SMS" && <Smartphone className="h-3 w-3 mr-1" />}
                        {ch === "PUSH" && <Bell className="h-3 w-3 mr-1" />}
                        {ch}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="preferences" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Notification Preferences</CardTitle>
              <CardDescription>Control which notifications are sent to which roles</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { event: "Job Assigned", admin: true, cleaner: true, client: false },
                { event: "Job Completed", admin: true, cleaner: false, client: true },
                { event: "Low Stock Alert", admin: true, cleaner: false, client: false },
                { event: "Invoice Sent", admin: true, cleaner: false, client: true },
                { event: "Payroll Processed", admin: true, cleaner: true, client: false },
                { event: "Laundry Ready", admin: true, cleaner: false, client: false },
              ].map((pref, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{pref.event}</span>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-tertiary">Admin</span>
                        <Switch defaultChecked={pref.admin} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-tertiary">Cleaner</span>
                        <Switch defaultChecked={pref.cleaner} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text-tertiary">Client</span>
                        <Switch defaultChecked={pref.client} />
                      </div>
                    </div>
                  </div>
                  <Separator className="mt-3" />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Delivery Logs</CardTitle>
              <CardDescription>Recent notification delivery history</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { event: "job_assigned", recipient: "cleaner@sneekops.com.au", channel: "EMAIL", status: "SENT", time: "10 min ago" },
                    { event: "job_completed", recipient: "client@sneekops.com.au", channel: "EMAIL", status: "SENT", time: "15 min ago" },
                    { event: "stock_low", recipient: "admin@sneekops.com.au", channel: "EMAIL", status: "FAILED", time: "1 hour ago" },
                    { event: "invoice_sent", recipient: "client@sneekops.com.au", channel: "EMAIL", status: "SENT", time: "2 hours ago" },
                  ].map((log, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-sm font-mono">{log.event}</TableCell>
                      <TableCell className="text-sm">{log.recipient}</TableCell>
                      <TableCell className="text-sm">{log.channel}</TableCell>
                      <TableCell>
                        <Badge variant={log.status === "SENT" ? "success" : "danger"}>{log.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-text-tertiary">{log.time}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
