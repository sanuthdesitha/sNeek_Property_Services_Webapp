import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export default function LaundrySettingsPage() {
  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-text-primary">Settings</h1><p className="text-text-secondary mt-1">Manage your notification preferences</p></div>
      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">Notification Preferences</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Switch label="New pickup notifications" defaultChecked description="Get notified when a new pickup is scheduled" />
          <Separator />
          <Switch label="Task assignment notifications" defaultChecked description="Get notified when assigned a new task" />
          <Separator />
          <Switch label="Schedule change notifications" defaultChecked description="Get notified when schedule changes" />
        </CardContent>
      </Card>
    </div>
  );
}
