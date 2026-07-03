"use client";

/**
 * Onboarding wizard step: "Checklist Preview & Approval".
 *
 * Composes the property's cleaning checklist live from the checklist library +
 * everything captured so far (appliances with requires-clean, balcony, rooms,
 * laundry setup). The reviewer toggles sections/items, adds property-specific
 * tasks, and previews the EXACT cleaner form. The selections are stored on the
 * survey; when the survey is approved the profile + property-specific form
 * templates are generated automatically for the selected cleaning types.
 */

import { PropertyChecklistBuilder } from "@/components/admin/property-checklist-builder";

export function StepChecklist({ surveyId }: { surveyId: string }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
        Review the checklist this property&apos;s cleaner form will use. Amenities came from the Rooms &amp;
        Appliances step — anything the property doesn&apos;t have (no dishwasher, no oven, no balcony) is
        already switched off. Use <span className="font-medium text-foreground">Save draft</span> to keep your
        edits; the property-specific form is generated automatically when this onboarding is approved.
      </div>
      <PropertyChecklistBuilder
        apiBase={`/api/admin/onboarding/surveys/${surveyId}/checklist`}
        mode="survey"
      />
    </div>
  );
}
