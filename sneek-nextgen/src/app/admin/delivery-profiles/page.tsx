import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, FileText } from "lucide-react";

export default function DeliveryProfilesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Delivery Profiles</h1>
          <p className="text-text-secondary mt-1">Commercial delivery profile management</p>
        </div>
        <Button><Plus className="h-4 w-4 mr-2" />New Profile</Button>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6 text-center text-text-secondary">
          <FileText className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
          <p>No delivery profiles configured</p>
          <p className="text-xs text-text-tertiary mt-1">Commercial delivery profiles define service level agreements for commercial clients</p>
        </CardContent>
      </Card>
    </div>
  );
}
