import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, CreditCard, Bell, Shield, RotateCcw } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">Configure your application settings</p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">General Settings</CardTitle>
              <CardDescription>Company name, timezone, and defaults</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input label="Company Name" defaultValue="sNeek Property Service" />
              <Select
                label="Timezone"
                defaultValue="Australia/Sydney"
                options={[
                  { value: "Australia/Sydney", label: "Australia/Sydney (AEST)" },
                  { value: "Australia/Melbourne", label: "Australia/Melbourne (AEST)" },
                  { value: "Australia/Brisbane", label: "Australia/Brisbane (AEST)" },
                  { value: "Australia/Perth", label: "Australia/Perth (AWST)" },
                ]}
              />
              <Input label="Default Reminder (24h before)" type="time" defaultValue="18:00" />
              <Input label="Default Reminder (2h before)" type="time" defaultValue="06:00" />
              <Input label="QA Pass Threshold (%)" type="number" defaultValue="80" />
              <Input label="GST Rate (%)" type="number" defaultValue="10" />
              <Button>Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Payment Gateways</CardTitle>
              <CardDescription>Configure payment providers</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div>
                  <p className="font-medium">Stripe</p>
                  <p className="text-sm text-text-tertiary">Primary payment processor</p>
                </div>
                <Switch label="Enabled" defaultChecked />
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div>
                  <p className="font-medium">PayPal</p>
                  <p className="text-sm text-text-tertiary">Alternative payment method</p>
                </div>
                <Switch label="Enabled" />
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div>
                  <p className="font-medium">Square</p>
                  <p className="text-sm text-text-tertiary">In-person payments</p>
                </div>
                <Switch label="Enabled" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Notification Settings</CardTitle>
              <CardDescription>Email, SMS, and push notification preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Switch label="Job assignment notifications" defaultChecked />
              <Separator />
              <Switch label="Job completion notifications" defaultChecked />
              <Separator />
              <Switch label="Low stock alerts" defaultChecked />
              <Separator />
              <Switch label="Laundry ready notifications" defaultChecked />
              <Separator />
              <Switch label="Invoice sent notifications" defaultChecked />
              <Separator />
              <Switch label="Payroll processed notifications" defaultChecked />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card variant="outlined">
            <CardHeader>
              <CardTitle className="text-base">Security Settings</CardTitle>
              <CardDescription>Password policies and session management</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input label="Session Timeout (hours)" type="number" defaultValue="24" />
              <Input label="Max Login Attempts" type="number" defaultValue="5" />
              <Switch label="Require password reset on first login" defaultChecked />
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Restore Default Settings</p>
                  <p className="text-sm text-text-tertiary">Reset all settings to defaults</p>
                </div>
                <Button variant="outline">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restore
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
