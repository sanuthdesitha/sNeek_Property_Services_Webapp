"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const AREAS = ["KITCHEN", "BATHROOM", "BEDROOM", "LIVING", "OUTDOOR", "GARAGE", "WHOLE_PROPERTY", "OTHER"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

interface SpecialRequest {
  description: string;
  priority: string;
  area: string;
}

interface StepSpecialRequestsProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepSpecialRequests({ data, onChange }: StepSpecialRequestsProps) {
  const requests: SpecialRequest[] = (data.specialRequests as SpecialRequest[]) ?? [];

  const addRequest = () => {
    onChange({
      ...data,
      specialRequests: [...requests, { description: "", priority: "NORMAL", area: "" }],
    });
  };

  const updateRequest = (index: number, field: keyof SpecialRequest, value: unknown) => {
    const updated = [...requests];
    updated[index] = { ...updated[index], [field]: value };
    onChange({ ...data, specialRequests: updated });
  };

  const removeRequest = (index: number) => {
    onChange({ ...data, specialRequests: requests.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Any special cleaning requests from the client beyond the standard checklist.
      </p>

      {requests.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground">
          No special requests yet.
        </div>
      )}

      {requests.map((req, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-end">
          <div className="flex-[3]">
            <Label>Description</Label>
            <Textarea
              value={req.description}
              onChange={(e) => updateRequest(i, "description", e.target.value)}
              placeholder="Describe the special request"
              rows={1}
            />
          </div>
          <div className="flex-1">
            <Label>Area</Label>
            <Select value={req.area} onValueChange={(v) => updateRequest(i, "area", v)}>
              <SelectTrigger><SelectValue placeholder="Area" /></SelectTrigger>
              <SelectContent>
                {AREAS.map((a) => <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label>Priority</Label>
            <Select value={req.priority} onValueChange={(v) => updateRequest(i, "priority", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="icon" onClick={() => removeRequest(i)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}

      <Button variant="outline" onClick={addRequest}>
        <Plus className="mr-1 h-4 w-4" />
        Add request
      </Button>
    </div>
  );
}
