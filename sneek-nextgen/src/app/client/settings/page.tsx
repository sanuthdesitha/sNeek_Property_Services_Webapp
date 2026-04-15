import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export default function ClientSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">Manage your notification and portal preferences</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Switch label="Job completion notifications" defaultChecked description="Get notified when a job is completed" />
          <Separator />
          <Switch label="Job start notifications" defaultChecked description="Get notified when a cleaner starts" />
          <Separator />
          <Switch label="Invoice notifications" defaultChecked description="Get notified when a new invoice is ready" />
          <Separator />
          <Switch label="Report notifications" defaultChecked description="Get notified when a report is generated" />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Portal Visibility</CardTitle>
          <CardDescription>Choose which sections you can see in your portal</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Switch label="Show inventory section" defaultChecked />
          <Separator />
          <Switch label="Show laundry section" defaultChecked />
          <Separator />
          <Switch label="Show shopping section" defaultChecked />
          <Separator />
          <Switch label="Show finance section" defaultChecked />
        </CardContent>
      </Card>
    </div>
  );
}
