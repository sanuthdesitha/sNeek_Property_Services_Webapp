"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const APPLIANCE_TYPES = [
  "OVEN", "FRIDGE", "DISHWASHER", "WASHER", "DRYER", "RANGEHOOD", "MICROWAVE", "OTHER",
];

interface Appliance {
  applianceType: string;
  conditionNote: string;
  requiresClean: boolean;
}

interface StepAppliancesProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepAppliances({ data, onChange }: StepAppliancesProps) {
  const appliances: Appliance[] = (data.appliances as Appliance[]) ?? [];

  const addAppliance = () => {
    onChange({
      ...data,
      appliances: [...appliances, { applianceType: "OVEN", conditionNote: "", requiresClean: true }],
    });
  };

  const updateAppliance = (index: number, field: keyof Appliance, value: unknown) => {
    const updated = [...appliances];
    updated[index] = { ...updated[index], [field]: value };
    onChange({ ...data, appliances: updated });
  };

  const removeAppliance = (index: number) => {
    onChange({ ...data, appliances: appliances.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        List any special appliances that need cleaning (oven, fridge, etc.).
      </p>

      {appliances.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          No appliances added yet. Click &quot;Add appliance&quot; to start.
        </div>
      )}

      {appliances.map((appliance, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end">
          <div className="flex-1">
            <Label>Type</Label>
            <Select value={appliance.applianceType} onValueChange={(v) => updateAppliance(i, "applianceType", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APPLIANCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-[2]">
            <Label>Condition note</Label>
            <Textarea
              value={appliance.conditionNote}
              onChange={(e) => updateAppliance(i, "conditionNote", e.target.value)}
              placeholder="e.g., Heavy grease buildup"
              rows={1}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={appliance.requiresClean}
              onCheckedChange={(v) => updateAppliance(i, "requiresClean", v === true)}
            />
            <Label className="text-sm">Clean</Label>
          </div>
          <Button variant="ghost" size="icon" onClick={() => removeAppliance(i)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}

      <Button variant="outline" onClick={addAppliance}>
        <Plus className="mr-1 h-4 w-4" />
        Add appliance
      </Button>
    </div>
  );
}
