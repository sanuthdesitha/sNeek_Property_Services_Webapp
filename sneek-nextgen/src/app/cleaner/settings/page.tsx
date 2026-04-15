import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export default function CleanerSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">Manage your notification preferences</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Switch label="Job assignment notifications" defaultChecked description="Get notified when a new job is assigned to you" />
          <Separator />
          <Switch label="Job reminder (24h before)" defaultChecked description="Reminder about upcoming jobs" />
          <Separator />
          <Switch label="Job reminder (2h before)" defaultChecked description="Final reminder before your shift" />
          <Separator />
          <Switch label="Payroll processed" defaultChecked description="Notification when your pay is processed" />
          <Separator />
          <Switch label="Workforce announcements" defaultChecked description="Team announcements and updates" />
          <Separator />
          <Switch label="Learning assignments" description="New training courses assigned to you" />
        </CardContent>
      </Card>
    </div>
  );
}
