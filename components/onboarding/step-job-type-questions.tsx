"use client";

import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getRelevantQuestions } from "@/lib/onboarding/questions/engine";

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
  const [questions, setQuestions] = useState<any[]>([]);
  const jobTypeAnswers = (data.jobTypeAnswers as Array<{ jobType: string; answers: Record<string, unknown>; isComplete: boolean }>) ?? [];
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => {
    const flat: Record<string, unknown> = {};
    for (const a of jobTypeAnswers) {
      for (const [k, v] of Object.entries(a.answers)) {
        flat[`${a.jobType}.${k}`] = v;
      }
    }
    return flat;
  });

  useEffect(() => {
    const relevant = getRelevantQuestions(
      { ...data, selectedJobTypes },
      Object.keys(answers)
    );
    setQuestions(relevant);
  }, [selectedJobTypes, data]);

  const toggleJobType = (jobType: string) => {
    const updated = selectedJobTypes.includes(jobType)
      ? selectedJobTypes.filter((jt) => jt !== jobType)
      : [...selectedJobTypes, jobType];
    onChange({ ...data, selectedJobTypes: updated });
  };

  const handleAnswer = (questionId: string, value: unknown) => {
    const updated = { ...answers, [questionId]: value };
    setAnswers(updated);

    // Group answers by job type prefix
    const grouped: Record<string, { jobType: string; answers: Record<string, unknown>; isComplete: boolean }> = {};
    for (const [key, val] of Object.entries(updated)) {
      const parts = key.split(".");
      const jobType = parts[0];
      const fieldKey = parts.slice(1).join(".");
      if (!grouped[jobType]) grouped[jobType] = { jobType, answers: {}, isComplete: true };
      grouped[jobType].answers[fieldKey] = val;
    }
    onChange({ ...data, jobTypeAnswers: Object.values(grouped) });
  };

  const renderField = (q: any) => {
    const value = answers[q.id];
    switch (q.type) {
      case "boolean":
        return (
          <label className="flex items-center gap-2">
            <Checkbox checked={value === true} onCheckedChange={(v) => handleAnswer(q.id, v === true)} />
            <span className="text-sm">{q.label}</span>
          </label>
        );
      case "select":
        return (
          <div>
            <Label>{q.label}</Label>
            <Select value={String(value ?? "")} onValueChange={(v) => handleAnswer(q.id, v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {(q.options ?? []).map((opt: any) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case "number":
        return (
          <div>
            <Label>{q.label}</Label>
            <Input type="number" value={value !== undefined && value !== null ? String(value) : ""} onChange={(e) => handleAnswer(q.id, e.target.value ? Number(e.target.value) : null)} />
          </div>
        );
      case "textarea":
        return (
          <div>
            <Label>{q.label}</Label>
            <Textarea value={String(value ?? "")} onChange={(e) => handleAnswer(q.id, e.target.value)} />
          </div>
        );
      default:
        return (
          <div>
            <Label>{q.label}</Label>
            <Input value={String(value ?? "")} onChange={(e) => handleAnswer(q.id, e.target.value)} />
          </div>
        );
    }
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

      {questions.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Label className="text-base">Follow-up questions</Label>
            <Badge variant="outline">{questions.length} question{questions.length !== 1 ? "s" : ""}</Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {questions.map((q) => (
              <div key={q.id}>{renderField(q)}</div>
            ))}
          </div>
        </div>
      )}

      {questions.length === 0 && selectedJobTypes.length > 0 && (
        <p className="text-sm text-muted-foreground">No additional questions for the selected cleaning types.</p>
      )}
    </div>
  );
}
