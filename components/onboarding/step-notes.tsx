"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface StepNotesProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepNotes({ data, onChange }: StepNotesProps) {
  const update = (key: string, value: unknown) => onChange({ ...data, [key]: value });

  return (
    <div className="grid gap-4">
      <div>
        <Label>Parking instructions</Label>
        <Textarea
          value={String(data.parkingInstructions ?? "")}
          onChange={(e) => update("parkingInstructions", e.target.value)}
          placeholder="Where should cleaners park? Any permits needed?"
        />
      </div>
      <div>
        <Label>Timing instructions</Label>
        <Textarea
          value={String(data.timingInstructions ?? "")}
          onChange={(e) => update("timingInstructions", e.target.value)}
          placeholder="Preferred cleaning times, noise restrictions, etc."
        />
      </div>
      <div>
        <Label>Special notes</Label>
        <Textarea
          value={String(data.specialNotes ?? "")}
          onChange={(e) => update("specialNotes", e.target.value)}
          placeholder="Any other important information for cleaners"
          rows={4}
        />
      </div>
    </div>
  );
}
