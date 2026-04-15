"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  steps: { id: string; label: string }[];
  currentStep: string;
  completedSteps: string[];
  onStepClick?: (stepId: string) => void;
}

export function StepIndicator({ steps, currentStep, completedSteps, onStepClick }: StepIndicatorProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStep);

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex min-w-[600px] items-center gap-1 px-2">
        {steps.map((step, i) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = step.id === currentStep;
          const isPast = i < currentIndex;

          return (
            <div key={step.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onStepClick?.(step.id)}
                disabled={!isCompleted && !isPast && !isCurrent}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors",
                  isCompleted && "bg-green-600 text-white",
                  isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2",
                  isPast && !isCompleted && "bg-muted text-muted-foreground",
                  !isCompleted && !isCurrent && !isPast && "bg-muted/50 text-muted-foreground cursor-not-allowed"
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : i + 1}
              </button>
              <span
                className={cn(
                  "ml-1.5 whitespace-nowrap text-xs",
                  isCurrent && "font-semibold text-foreground",
                  isCompleted && "text-green-600",
                  !isCurrent && !isCompleted && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
              {i < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-1 h-px w-4 shrink-0",
                    isPast || isCompleted ? "bg-green-600" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
