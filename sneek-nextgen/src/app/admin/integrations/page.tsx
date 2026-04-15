import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plug, RefreshCw, CheckCircle, AlertCircle, ExternalLink } from "lucide-react";

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Integrations</h1>
        <p className="text-text-secondary mt-1">Manage third-party integrations and connections</p>
      </div>

      <Tabs defaultValue="ical">
        <TabsList>
          <TabsTrigger value="ical">iCal Sync</TabsTrigger>
          <TabsTrigger value="xero">Xero</TabsTrigger>
          <TabsTrigger value="stripe">Stripe</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
        </TabsList>

        <TabsContent value="ical" className="space-y-4">
          {[
            { property: "Harbour View Apartment", provider: "Hospitable", status: "SUCCESS", lastSync: "2026-04-15 09:30", url: "ical.hospitable.com/..." },
            { property: "Beach House", provider: "Not configured", status: "IDLE", lastSync: null, url: null },
          ].map((integration, i) => (
            <Card key={i} variant="outlined">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{integration.property}</CardTitle>
                  <Badge variant={integration.status === "SUCCESS" ? "success" : "neutral"}>
                    {integration.status === "SUCCESS" ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
                    {integration.status}
                  </Badge>
                </div>
                <CardDescription>{integration.provider} {integration.lastSync ? `&middot; Last sync: ${integration.lastSync}` : ""}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Sync Now
                  </Button>
                  <Button variant="outline" size="sm">View History</Button>
                  <Button variant="outline" size="sm">Configure</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="xero" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Xero Accounting</CardTitle>
              <CardDescription>Connect to Xero for invoicing and payroll</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <Plug className="h-6 w-6 text-text-tertiary" />
                  <div>
                    <p className="font-medium">Xero Connection</p>
                    <p className="text-sm text-text-tertiary">Not connected</p>
                  </div>
                </div>
                <Button>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Connect to Xero
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stripe" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Stripe</CardTitle>
              <CardDescription>Payment processing and Connect payouts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <Plug className="h-6 w-6 text-text-tertiary" />
                  <div>
                    <p className="font-medium">Stripe Connect</p>
                    <p className="text-sm text-text-tertiary">Configure Stripe for payment processing</p>
                  </div>
                </div>
                <Button variant="outline">Configure</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credentials" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Integration Credentials</CardTitle>
              <CardDescription>Manage API keys and secrets for integrations</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-secondary">Configure credentials for third-party services used by the platform.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
