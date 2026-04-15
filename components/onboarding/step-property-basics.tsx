"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface StepPropertyBasicsProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

const PROPERTY_TYPES = [
  { value: "HOUSE", label: "House" },
  { value: "APARTMENT", label: "Apartment" },
  { value: "UNIT", label: "Unit" },
  { value: "TOWNHOUSE", label: "Townhouse" },
  { value: "DUPLEX", label: "Duplex" },
];

export function StepPropertyBasics({ data, onChange }: StepPropertyBasicsProps) {
  const update = (key: string, value: unknown) => onChange({ ...data, [key]: value });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label>Property name / identifier *</Label>
        <Input
          value={String(data.propertyName ?? "")}
          onChange={(e) => update("propertyName", e.target.value)}
          placeholder="e.g., 42 Smith St - Johnson"
        />
      </div>
      <div className="md:col-span-2">
        <Label>Address *</Label>
        <Input
          value={String(data.propertyAddress ?? "")}
          onChange={(e) => update("propertyAddress", e.target.value)}
          placeholder="Full street address"
        />
      </div>
      <div>
        <Label>Suburb</Label>
        <Input
          value={String(data.propertySuburb ?? "")}
          onChange={(e) => update("propertySuburb", e.target.value)}
          placeholder="Suburb"
        />
      </div>
      <div>
        <Label>State</Label>
        <Select value={String(data.propertyState ?? "NSW")} onValueChange={(v) => update("propertyState", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Postcode</Label>
        <Input
          value={String(data.propertyPostcode ?? "")}
          onChange={(e) => update("propertyPostcode", e.target.value)}
          placeholder="2000"
        />
      </div>
      <div>
        <Label>Property type</Label>
        <Select value={String(data.propertyType ?? "")} onValueChange={(v) => update("propertyType", v)}>
          <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
          <SelectContent>
            {PROPERTY_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Bedrooms</Label>
        <Input
          type="number"
          min={0}
          max={50}
          value={Number(data.bedrooms ?? 1)}
          onChange={(e) => update("bedrooms", parseInt(e.target.value) || 0)}
        />
      </div>
      <div>
        <Label>Bathrooms</Label>
        <Input
          type="number"
          min={0}
          max={50}
          value={Number(data.bathrooms ?? 1)}
          onChange={(e) => update("bathrooms", parseInt(e.target.value) || 0)}
        />
      </div>
      <div>
        <Label>Floor count</Label>
        <Input
          type="number"
          min={1}
          max={20}
          value={Number(data.floorCount ?? 1)}
          onChange={(e) => update("floorCount", parseInt(e.target.value) || 1)}
        />
      </div>
      <div>
        <Label>Size (sqm)</Label>
        <Input
          type="number"
          min={0}
          max={50000}
          value={data.sizeSqm ? String(data.sizeSqm) : ""}
          onChange={(e) => update("sizeSqm", e.target.value ? parseFloat(e.target.value) : null)}
          placeholder="Leave blank to estimate"
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={data.hasBalcony === true}
          onCheckedChange={(v) => update("hasBalcony", v === true)}
        />
        <Label className="text-sm">Has balcony</Label>
      </div>
      <div className="md:col-span-2">
        <Label>Property notes</Label>
        <Textarea
          value={String(data.propertyNotes ?? "")}
          onChange={(e) => update("propertyNotes", e.target.value)}
          placeholder="Any general notes about the property"
        />
      </div>
    </div>
  );
}
