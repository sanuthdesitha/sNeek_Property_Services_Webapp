"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WizardLayout } from "@/components/onboarding/wizard-layout";
import { StepClientInfo } from "@/components/onboarding/step-client-info";
import { StepPropertyBasics } from "@/components/onboarding/step-property-basics";
import { StepAppliances } from "@/components/onboarding/step-appliances";
import { StepSpecialRequests } from "@/components/onboarding/step-special-requests";
import { StepLaundry } from "@/components/onboarding/step-laundry";
import { StepAccess } from "@/components/onboarding/step-access";
import { StepNotes } from "@/components/onboarding/step-notes";
import { StepStaffing } from "@/components/onboarding/step-staffing";
import { StepIcal } from "@/components/onboarding/step-ical";
import { StepJobTypeQuestions } from "@/components/onboarding/step-job-type-questions";
import { StepReview } from "@/components/onboarding/step-review";
import { toast } from "@/hooks/use-toast";

const STEPS = [
  { id: "client", label: "Client Info" },
  { id: "property", label: "Property Basics" },
  { id: "appliances", label: "Appliances" },
  { id: "requests", label: "Special Requests" },
  { id: "laundry", label: "Laundry" },
  { id: "access", label: "Access" },
  { id: "notes", label: "Notes" },
  { id: "staffing", label: "Staffing" },
  { id: "ical", label: "iCal" },
  { id: "jobtypes", label: "Cleaning Types" },
  { id: "review", label: "Review" },
];

export default function NewOnboardingPage() {
  const router = useRouter();
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(STEPS[0].id);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [creating, setCreating] = useState(true);

  useEffect(() => {
    fetch("/api/admin/onboarding/surveys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.id) {
          setSurveyId(data.id);
        } else {
          toast({ title: "Failed to create survey", variant: "destructive" });
        }
      })
      .catch(() => toast({ title: "Failed to create survey", variant: "destructive" }))
      .finally(() => setCreating(false));
  }, []);

  const handleCompleteStep = useCallback(async (stepId: string, stepData: Record<string, unknown>) => {
    if (!surveyId) return false;

    const mergedData = { ...formData, ...stepData };
    setFormData(mergedData);

    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mergedData),
      });
      if (!res.ok) throw new Error("Failed to save");

      setCompletedSteps((prev) => prev.includes(stepId) ? prev : [...prev, stepId]);
      return true;
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
      return false;
    }
  }, [surveyId, formData]);

  const handleNavigate = useCallback((stepId: string) => {
    setCurrentStep(stepId);
  }, []);

  if (creating || !surveyId) {
    return <p className="text-sm text-muted-foreground">Creating survey...</p>;
  }

  const stepComponents = {
    client: <StepClientInfo data={formData} onChange={setFormData} />,
    property: <StepPropertyBasics data={formData} onChange={setFormData} />,
    appliances: <StepAppliances data={formData} onChange={setFormData} />,
    requests: <StepSpecialRequests data={formData} onChange={setFormData} />,
    laundry: <StepLaundry data={formData} onChange={setFormData} />,
    access: <StepAccess data={formData} onChange={setFormData} />,
    notes: <StepNotes data={formData} onChange={setFormData} />,
    staffing: <StepStaffing data={formData} onChange={setFormData} />,
    ical: <StepIcal data={formData} onChange={setFormData} />,
    jobtypes: <StepJobTypeQuestions data={formData} onChange={setFormData} />,
    review: <StepReview surveyId={surveyId} data={formData} onComplete={() => setCompletedSteps((prev) => [...prev, "review"])} />,
  };

  return (
    <WizardLayout
      surveyId={surveyId}
      steps={STEPS.map((s) => ({ ...s, component: stepComponents[s.id as keyof typeof stepComponents] }))}
      currentStep={currentStep}
      completedSteps={completedSteps}
      onCompleteStep={handleCompleteStep}
      onNavigate={handleNavigate}
    />
  );
}
