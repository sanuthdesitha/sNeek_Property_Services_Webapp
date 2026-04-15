"use client";

import { ReactNode, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StepIndicator } from "./step-indicator";
import { toast } from "@/hooks/use-toast";

interface WizardStep {
  id: string;
  label: string;
  component: ReactNode;
}

interface WizardLayoutProps {
  surveyId: string;
  steps: WizardStep[];
  currentStep: string;
  completedSteps: string[];
  onCompleteStep: (stepId: string, data: Record<string, unknown>) => Promise<boolean>;
  onNavigate: (stepId: string) => void;
  isSubmitting?: boolean;
}

export function WizardLayout({
  surveyId,
  steps,
  currentStep,
  completedSteps,
  onCompleteStep,
  onNavigate,
  isSubmitting,
}: WizardLayoutProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const currentIndex = steps.findIndex((s) => s.id === currentStep);
  const currentStepDef = steps[currentIndex];

  const handleNext = useCallback(async () => {
    if (currentIndex >= steps.length - 1) return;
    const ok = await onCompleteStep(currentStep, {});
    if (ok) onNavigate(steps[currentIndex + 1].id);
  }, [currentIndex, steps, currentStep, onCompleteStep, onNavigate]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onCompleteStep(currentStep, {});
      toast({ title: "Draft saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [currentStep, onCompleteStep]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/admin/onboarding")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
          <Save className="mr-1 h-3 w-3" />
          Save Draft
        </Button>
      </div>

      <StepIndicator
        steps={steps}
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={(id) => {
          if (completedSteps.includes(id) || id === currentStep) onNavigate(id);
        }}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>{currentStepDef?.label}</CardTitle>
          <CardDescription>
            Step {currentIndex + 1} of {steps.length}
          </CardDescription>
        </CardHeader>
        <CardContent>{currentStepDef?.component}</CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => currentIndex > 0 && onNavigate(steps[currentIndex - 1].id)}
          disabled={currentIndex === 0}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <Button onClick={handleNext} disabled={isSubmitting || currentIndex >= steps.length - 1}>
          {currentIndex >= steps.length - 2 ? (
            <>Review & Submit<ArrowRight className="ml-1 h-4 w-4" /></>
          ) : (
            <>Next<ArrowRight className="ml-1 h-4 w-4" /></>
          )}
        </Button>
      </div>
    </div>
  );
}
