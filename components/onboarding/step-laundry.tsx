"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface StepLaundryProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepLaundry({ data, onChange }: StepLaundryProps) {
  const laundry = (data.laundryDetail as Record<string, unknown>) ?? {};
  const update = (key: string, value: unknown) => onChange({ ...data, laundryDetail: { ...laundry, [key]: value } });

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={laundry.hasLaundry === true}
          onCheckedChange={(v) => update("hasLaundry", v === true)}
        />
        <span className="text-sm">Property has laundry</span>
      </label>

      {laundry.hasLaundry === true && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Washer type</Label>
            <Select value={String(laundry.washerType ?? "")} onValueChange={(v) => update("washerType", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["FRONT_LOAD", "TOP_LOAD", "COMBO"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Dryer type</Label>
            <Select value={String(laundry.dryerType ?? "")} onValueChange={(v) => update("dryerType", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["DRYER", "COMBO", "NONE"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Laundry location</Label>
            <Select value={String(laundry.laundryLocation ?? "")} onValueChange={(v) => update("laundryLocation", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["INSIDE_UNIT", "SEPARATE_ROOM", "GARAGE", "OUTDOOR"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Detergent type</Label>
            <Select value={String(laundry.detergentType ?? "")} onValueChange={(v) => update("detergentType", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["STANDARD", "HYPOALLERGENIC", "ECO", "CLIENT_PROVIDED"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={laundry.suppliesProvided === true}
              onCheckedChange={(v) => update("suppliesProvided", v === true)}
            />
            <span className="text-sm">Supplies provided by client</span>
          </label>
          <div className="md:col-span-2">
            <Label>Laundry notes</Label>
            <Textarea
              value={String(laundry.notes ?? "")}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Any laundry-specific instructions"
            />
          </div>
        </div>
      )}
    </div>
  );
}
