"use client";

/**
 * Cleaner-only payroll-compliance cards ported from the v1 profile
 * (components/cleaner/cleaner-profile-form.tsx §3, §5, §6, Notes):
 *   1. Employment — engagement type + work rights / visa status
 *   2. Skills & equipment — languages, vehicle, rego / licence expiries
 *   3. Tax — "TFN is on file" declaration (a boolean, deliberately NOT a TFN
 *      capture field; we never store the actual number)
 *   4. Notes to admin
 *
 * Lives under v2/cleaner (not v2/laundry) because the shared EstateProfile is
 * also mounted by the laundry/QA portals, which must stay pixel-identical —
 * EstateProfile only renders these when `showEmploymentSections` is set.
 *
 * Every field persists through the SAME PATCH /api/me/profile endpoint the v1
 * form used; the route's extendedProfileSchema already allowlists all of them,
 * so no API change is required.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";

/* Mirrors the VisaStatus / EmploymentType Prisma enums (values validated by
 * the route's zod schema — keep in sync with app/api/me/profile/route.ts). */
type VisaStatus = "CITIZEN" | "PERMANENT_RESIDENT" | "WORK_VISA" | "STUDENT_VISA" | "OTHER";
type EmploymentType = "CONTRACTOR" | "CASUAL" | "PART_TIME" | "FULL_TIME";

export interface EmploymentSectionsUser {
  visaStatus?: VisaStatus | null;
  employmentType?: EmploymentType | null;
  taxFileNumberOnFile?: boolean;
  languages?: string[];
  hasVehicle?: boolean;
  vehicleRegoExpiry?: Date | string | null;
  driverLicenseExpiry?: Date | string | null;
  notes?: string | null;
}

/** Date | ISO string | null → yyyy-mm-dd for <input type="date">. */
function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Shared blur-save PATCH used by all four cards — same toast contract as the
 * other EstateProfile sections so saves feel identical across the page. */
function useProfilePatch() {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);

  const patch = React.useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch("/api/me/profile", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Save failed (${res.status})`);
        }
        toast({ title: "Profile saved" });
        router.refresh();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Something went wrong.";
        toast({ title: "Could not save", description: message, variant: "destructive" });
      } finally {
        setSaving(false);
      }
    },
    [router]
  );

  return { patch, saving };
}

function SavingHint({ saving }: { saving: boolean }) {
  if (!saving) return null;
  return (
    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]" aria-live="polite">
      Saving…
    </p>
  );
}

/* ── 1. Employment (engagement type + work rights) ─────────────────────── */
function EmploymentCard({ user, locked }: { user: EmploymentSectionsUser; locked: boolean }) {
  const { patch, saving } = useProfilePatch();
  const [employmentType, setEmploymentType] = React.useState<EmploymentType | "">(
    user.employmentType ?? ""
  );
  const [visaStatus, setVisaStatus] = React.useState<VisaStatus | "">(user.visaStatus ?? "");

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Employment</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Your engagement type and right to work. Used for payroll compliance.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-4">
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <EField label="Employment type">
            <ESelect
              value={employmentType}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value as EmploymentType;
                setEmploymentType(v);
                void patch({ employmentType: v });
              }}
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="CONTRACTOR">Contractor</option>
              <option value="CASUAL">Casual</option>
              <option value="PART_TIME">Part-time</option>
              <option value="FULL_TIME">Full-time</option>
            </ESelect>
          </EField>
          <EField label="Work rights / visa status">
            <ESelect
              value={visaStatus}
              disabled={saving}
              onChange={(e) => {
                const v = e.target.value as VisaStatus;
                setVisaStatus(v);
                void patch({ visaStatus: v });
              }}
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="CITIZEN">Citizen</option>
              <option value="PERMANENT_RESIDENT">Permanent resident</option>
              <option value="WORK_VISA">Work visa</option>
              <option value="STUDENT_VISA">Student visa</option>
              <option value="OTHER">Other</option>
            </ESelect>
          </EField>
        </fieldset>
        <SavingHint saving={saving} />
      </ECardBody>
    </ECard>
  );
}

/* ── 2. Skills & equipment ─────────────────────────────────────────────── */
function SkillsEquipmentCard({ user, locked }: { user: EmploymentSectionsUser; locked: boolean }) {
  const { patch, saving } = useProfilePatch();
  const [languagesText, setLanguagesText] = React.useState((user.languages ?? []).join(", "));
  const [hasVehicle, setHasVehicle] = React.useState(user.hasVehicle ?? false);
  const [vehicleRegoExpiry, setVehicleRegoExpiry] = React.useState(
    toDateInputValue(user.vehicleRegoExpiry)
  );
  const [driverLicenseExpiry, setDriverLicenseExpiry] = React.useState(
    toDateInputValue(user.driverLicenseExpiry)
  );

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Skills &amp; equipment</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Languages and vehicle details. Auto-saves on blur.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-4">
        <fieldset disabled={locked} className="grid gap-4 sm:grid-cols-2">
          <EField
            label="Languages spoken"
            hint="Comma-separated (e.g. English, Mandarin)."
            className="sm:col-span-2"
          >
            <EInput
              value={languagesText}
              onChange={(e) => setLanguagesText(e.target.value)}
              onBlur={() => {
                const parsed = languagesText
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                // Only PATCH on real change — blur fires often and each save toasts.
                if (JSON.stringify(parsed) !== JSON.stringify(user.languages ?? [])) {
                  void patch({ languages: parsed });
                }
              }}
            />
          </EField>

          <EField label="Has own vehicle" className="sm:col-span-2">
            <div className="flex items-center gap-3">
              <ESwitch
                checked={hasVehicle}
                disabled={locked || saving}
                aria-label="Has own vehicle"
                onCheckedChange={(v) => {
                  setHasVehicle(v);
                  void patch({ hasVehicle: v });
                }}
              />
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {hasVehicle ? "Yes, I drive to jobs." : "I rely on public transport."}
              </span>
            </div>
          </EField>

          <EField label="Vehicle rego expiry">
            <EInput
              type="date"
              value={vehicleRegoExpiry}
              onChange={(e) => setVehicleRegoExpiry(e.target.value)}
              onBlur={() =>
                vehicleRegoExpiry !== toDateInputValue(user.vehicleRegoExpiry) &&
                // Empty string means "cleared" — persist as null, not "".
                void patch({ vehicleRegoExpiry: vehicleRegoExpiry || null })
              }
            />
          </EField>
          <EField label="Driver licence expiry">
            <EInput
              type="date"
              value={driverLicenseExpiry}
              onChange={(e) => setDriverLicenseExpiry(e.target.value)}
              onBlur={() =>
                driverLicenseExpiry !== toDateInputValue(user.driverLicenseExpiry) &&
                void patch({ driverLicenseExpiry: driverLicenseExpiry || null })
              }
            />
          </EField>
        </fieldset>
        <SavingHint saving={saving} />
      </ECardBody>
    </ECard>
  );
}

/* ── 3. Tax (TFN-on-file declaration — boolean only, never the TFN) ────── */
function TaxCard({ user, locked }: { user: EmploymentSectionsUser; locked: boolean }) {
  const { patch, saving } = useProfilePatch();
  const [taxFileNumberOnFile, setTfn] = React.useState(user.taxFileNumberOnFile ?? false);

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Tax</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          We don&apos;t store your TFN. Tick this once you&apos;ve supplied it to admin.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <ESwitch
            checked={taxFileNumberOnFile}
            disabled={locked || saving}
            aria-label="Tax File Number is on file"
            onCheckedChange={(v) => {
              setTfn(v);
              void patch({ taxFileNumberOnFile: v });
            }}
          />
          <span className="text-[0.875rem] text-[hsl(var(--e-foreground))]">
            Tax File Number is on file
          </span>
        </div>
        <SavingHint saving={saving} />
      </ECardBody>
    </ECard>
  );
}

/* ── 4. Notes to admin ─────────────────────────────────────────────────── */
function NotesCard({ user, locked }: { user: EmploymentSectionsUser; locked: boolean }) {
  const { patch, saving } = useProfilePatch();
  const [notes, setNotes] = React.useState(user.notes ?? "");

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle>Notes</ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Anything you want admin to know.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-3">
        <fieldset disabled={locked}>
          <ETextarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (user.notes ?? "") && void patch({ notes })}
            aria-label="Notes to admin"
          />
        </fieldset>
        <SavingHint saving={saving} />
      </ECardBody>
    </ECard>
  );
}

/** The four cleaner compliance cards, in v1 order (employment → skills → tax → notes). */
export function EmploymentSections({
  user,
  locked,
}: {
  user: EmploymentSectionsUser;
  locked: boolean;
}) {
  return (
    <>
      <EmploymentCard user={user} locked={locked} />
      <SkillsEquipmentCard user={user} locked={locked} />
      <TaxCard user={user} locked={locked} />
      <NotesCard user={user} locked={locked} />
    </>
  );
}
