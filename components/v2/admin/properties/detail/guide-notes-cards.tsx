"use client";

/**
 * Overview's "Setup guide" (summary; Edit steps opens the existing step
 * editor) and "Notes and onboarding" (notes with their own Edit; what was
 * captured at onboarding stays read only, as before — those columns have no
 * save path).
 */
import { ETextarea, EField } from "@/components/v2/admin/estate-kit";
import { PropertySetupGuideEditor, type SetupGuideEntry } from "../property-setup-guide-editor";
import { Muted, SectionCard } from "./section-card";
import type { PropertyRecord } from "./property-record";
import type { SaveResult } from "./use-property-record";

type Save = (patch: Record<string, unknown>) => Promise<SaveResult>;

export function SetupGuideCard({ property, save }: { property: PropertyRecord; save: Save }) {
  const steps = Array.isArray(property.setupGuide) ? property.setupGuide : [];
  const images = steps.flatMap((step) => (Array.isArray(step.images) ? step.images : []));
  const withPhotos = steps.filter((step) => Array.isArray(step.images) && step.images.length > 0).length;
  return (
    <SectionCard<{ steps: SetupGuideEntry[] }>
      title="Setup guide"
      editLabel="Edit steps"
      className="flex-1"
      view={
        steps.length === 0 ? (
          <Muted>No setup steps yet.</Muted>
        ) : (
          <div className="flex flex-col gap-2 text-[0.8125rem]">
            <span>
              {steps.length} {steps.length === 1 ? "step" : "steps"}{withPhotos > 0 ? `, ${withPhotos} with photos` : ""}: {steps.map((step) => step.label).filter(Boolean).join(", ")}.
            </span>
            {images.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {images.slice(0, 3).map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={image.key ?? image.url} src={image.url} alt={image.caption ?? ""} className="h-12 w-16 rounded-[6px] border border-[hsl(var(--e-border))] object-cover" />
                ))}
                {images.length > 3 ? <Muted>+{images.length - 3}</Muted> : null}
              </div>
            ) : null}
          </div>
        )
      }
      initialDraft={() => ({ steps })}
      form={(draft, setDraft) => <PropertySetupGuideEditor value={draft.steps} onChange={(next) => setDraft({ steps: next })} />}
      onSave={(draft) => save({ setupGuide: draft.steps })}
      savedMessage="Setup guide saved"
    />
  );
}

const LAUNDRY_LABELS: Array<[string, string]> = [
  ["washerType", "washer"], ["dryerType", "dryer"], ["laundryLocation", "location"], ["detergentType", "detergent"], ["suppliesProvided", "supplies provided"], ["notes", "notes"],
];
const RECURRING_LABELS: Array<[string, string]> = [["frequency", "frequency"], ["day", "day"], ["time", "time"], ["notes", "notes"]];

function describe(value: unknown, labels: Array<[string, string]>): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const parts = labels.flatMap(([key, label]) => {
    const raw = record[key];
    if (raw === null || raw === undefined || raw === "") return [];
    return [`${label} ${typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw)}`];
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Onboarding capture, read only (ACCESS-3: these columns are not in the update schema). */
export function onboardingSummary(property: PropertyRecord): string | null {
  const parts = [
    typeof property.floorCount === "number" ? `${property.floorCount} ${property.floorCount === 1 ? "floor" : "floors"}` : null,
    describe(property.laundryDetail, LAUNDRY_LABELS) ? `laundry: ${describe(property.laundryDetail, LAUNDRY_LABELS)}` : null,
    describe(property.recurringSchedule, RECURRING_LABELS) ? `recurring service: ${describe(property.recurringSchedule, RECURRING_LABELS)}` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function NotesCard({ property, save }: { property: PropertyRecord; save: Save }) {
  const onboarding = onboardingSummary(property);
  return (
    <SectionCard<{ notes: string }>
      title="Notes and onboarding"
      editLabel="Edit notes"
      className="flex-1"
      view={
        <div className="flex flex-col gap-2 text-[0.8125rem]">
          <span className="whitespace-pre-wrap">{property.notes?.trim() ? property.notes : <Muted>No notes.</Muted>}</span>
          {onboarding ? <Muted>From onboarding, read only: {onboarding}</Muted> : null}
        </div>
      }
      initialDraft={() => ({ notes: property.notes ?? "" })}
      form={(draft, setDraft) => (
        <EField label="Notes">
          <ETextarea value={draft.notes} onChange={(event) => setDraft({ notes: event.target.value })} />
        </EField>
      )}
      // Sent as written (an empty string clears the notes).
      onSave={(draft) => save({ notes: draft.notes })}
      savedMessage="Notes saved"
    />
  );
}
