"use client";

import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const JOB_TYPES = [
  { value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" },
  { value: "DEEP_CLEAN", label: "Deep Clean" },
  { value: "END_OF_LEASE", label: "End of Lease" },
  { value: "GENERAL_CLEAN", label: "General Clean" },
  { value: "POST_CONSTRUCTION", label: "Post Construction" },
  { value: "PRESSURE_WASH", label: "Pressure Wash" },
  { value: "WINDOW_CLEAN", label: "Window Clean" },
  { value: "LAWN_MOWING", label: "Lawn Mowing" },
  { value: "SPECIAL_CLEAN", label: "Special Clean" },
  { value: "COMMERCIAL_RECURRING", label: "Commercial Recurring" },
  { value: "CARPET_STEAM_CLEAN", label: "Carpet Steam Clean" },
  { value: "MOLD_TREATMENT", label: "Mold Treatment" },
  { value: "UPHOLSTERY_CLEANING", label: "Upholstery Cleaning" },
  { value: "TILE_GROUT_CLEANING", label: "Tile Grout Cleaning" },
  { value: "GUTTER_CLEANING", label: "Gutter Cleaning" },
  { value: "SPRING_CLEANING", label: "Spring Cleaning" },
];

interface StepJobTypeQuestionsProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepJobTypeQuestions({ data, onChange }: StepJobTypeQuestionsProps) {
  const selectedJobTypes = (data.selectedJobTypes as string[]) ?? [];
  const [notes, setNotes] = useState<string>(data.jobTypeNotes as string ?? "");

  const toggleJobType = (jobType: string) => {
    const updated = selectedJobTypes.includes(jobType)
      ? selectedJobTypes.filter((jt) => jt !== jobType)
      : [...selectedJobTypes, jobType];
    onChange({ ...data, selectedJobTypes: updated });
  };

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-base">Select cleaning types needed</Label>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
          {JOB_TYPES.map((jt) => (
            <label key={jt.value} className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <Checkbox
                checked={selectedJobTypes.includes(jt.value)}
                onCheckedChange={() => toggleJobType(jt.value)}
              />
              {jt.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <Label>Additional notes for selected types</Label>
        <Textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            onChange({ ...data, jobTypeNotes: e.target.value });
          }}
          placeholder="Any specific instructions for the selected cleaning types"
          rows={4}
        />
      </div>

      {selectedJobTypes.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {selectedJobTypes.length} cleaning type{selectedJobTypes.length !== 1 ? "s" : ""} selected.
        </p>
      )}
    </div>
  );
}
