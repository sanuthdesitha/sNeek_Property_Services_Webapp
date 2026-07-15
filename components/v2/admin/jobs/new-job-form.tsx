"use client";

/**
 * ESTATE-native job creation — a self-contained re-imagining of the classic
 * NewJobForm (components/admin/new-job-form). Posts to the SAME endpoints
 * (/api/admin/jobs + /api/admin/jobs/{id}/assign) and reads the same reference
 * data (/api/admin/properties, /clients, /users?role=CLEANER). Built purely on
 * the Estate kit — no imports from components/{ui,shared,admin} — so template
 * management, uploaded attachments, and Google address autocomplete (which live
 * in classic-only components) are intentionally omitted here; the classic
 * builder remains reachable for those deep flows.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EAlert,
} from "@/components/v2/ui/primitives";
import {
  EInput,
  ESelect,
  ETextarea,
  EField,
  ESwitch,
} from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";

const JOB_TYPES = [
  "AIRBNB_TURNOVER", "DEEP_CLEAN", "END_OF_LEASE", "MOVE_IN_CLEAN", "GENERAL_CLEAN", "POST_CONSTRUCTION",
  "PRESSURE_WASH", "WINDOW_CLEAN", "LAWN_MOWING", "SPECIAL_CLEAN", "COMMERCIAL_RECURRING",
] as const;
type JobType = (typeof JOB_TYPES)[number];
const AIRBNB_JOB_TYPE: JobType = "AIRBNB_TURNOVER";

type SiteMode = "existing_property" | "service_site";
type TimingPreset = "none" | "11:00" | "12:30" | "custom";
type TimingRule = { preset: TimingPreset; time: string };

type PropertyOption = { id: string; name: string; suburb: string; defaultCleanDurationHours: number };
type ClientOption = { id: string; name: string };
type CleanerOption = { id: string; name: string | null; email: string | null; isActive?: boolean };

type FormState = {
  propertyId: string; clientId: string; siteMode: SiteMode; jobType: JobType; scheduledDate: string;
  startTime: string; dueTime: string; endTime: string; estimatedHours: string;
  notes: string; internalNotes: string; tagsText: string; isDraft: boolean;
  guestName: string; reservationCode: string; guestPhone: string; guestEmail: string; guestProfileUrl: string;
  guestAdults: string; guestChildren: string; guestInfants: string;
  guestCheckinAtLocal: string; guestCheckoutAtLocal: string; guestLocationText: string;
  siteName: string; siteAddress: string; siteSuburb: string; siteState: string; sitePostcode: string;
  siteBedrooms: string; siteBathrooms: string; siteHasBalcony: boolean;
  siteContactName: string; siteContactPhone: string; serviceAreaSqm: string; floorCount: string;
  scopeOfWork: string; accessInstructions: string; parkingInstructions: string; hazardNotes: string; equipmentNotes: string;
  earlyCheckin: TimingRule; lateCheckout: TimingRule;
};

const initialForm = (propertyId = ""): FormState => ({
  propertyId, clientId: "", siteMode: "existing_property", jobType: AIRBNB_JOB_TYPE, scheduledDate: "",
  startTime: "10:00", dueTime: "15:00", endTime: "", estimatedHours: "",
  notes: "", internalNotes: "", tagsText: "", isDraft: false,
  guestName: "", reservationCode: "", guestPhone: "", guestEmail: "", guestProfileUrl: "",
  guestAdults: "", guestChildren: "", guestInfants: "", guestCheckinAtLocal: "", guestCheckoutAtLocal: "", guestLocationText: "",
  siteName: "", siteAddress: "", siteSuburb: "", siteState: "NSW", sitePostcode: "",
  siteBedrooms: "", siteBathrooms: "", siteHasBalcony: false,
  siteContactName: "", siteContactPhone: "", serviceAreaSqm: "", floorCount: "",
  scopeOfWork: "", accessInstructions: "", parkingInstructions: "", hazardNotes: "", equipmentNotes: "",
  earlyCheckin: { preset: "none", time: "" }, lateCheckout: { preset: "none", time: "" },
});

const parseTags = (text: string) => text.split(",").map((v) => v.trim()).filter(Boolean);
const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const apiRule = (rule: TimingRule) =>
  rule.preset === "none"
    ? { enabled: false, preset: "none" as const }
    : { enabled: true, preset: rule.preset, time: rule.preset === "custom" ? rule.time || undefined : undefined };

/** Compact Estate section shell. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[1rem]">{title}</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-4 pt-2">{children}</ECardBody>
    </ECard>
  );
}

/** Native Estate multi-select as a scrollable hairline checklist. */
function Checklist({
  options,
  selected,
  onChange,
  emptyText,
}: {
  options: Array<{ id: string; label: string; hint?: string; disabled?: boolean }>;
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}) {
  if (options.length === 0) {
    return <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">{emptyText}</p>;
  }
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1.5">
      {options.map((opt) => {
        const on = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            disabled={opt.disabled}
            onClick={() => onChange(on ? selected.filter((id) => id !== opt.id) : [...selected, opt.id])}
            className={
              "flex w-full items-center gap-2 rounded-[var(--e-radius-sm)] px-2 py-1.5 text-left text-[0.8125rem] transition-colors disabled:opacity-40 " +
              (on
                ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-foreground))]"
                : "text-[hsl(var(--e-text-secondary))] hover:bg-[hsl(var(--e-muted))]")
            }
          >
            <span
              className={
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border " +
                (on
                  ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                  : "border-[hsl(var(--e-border-strong))]")
              }
            >
              {on ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {opt.label}
              {opt.hint ? <span className="ml-1 text-[hsl(var(--e-text-faint))]">· {opt.hint}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NewJobForm({ initialPropertyId }: { initialPropertyId?: string }) {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [cleaners, setCleaners] = useState<CleanerOption[]>([]);
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [bulkPropertyIds, setBulkPropertyIds] = useState<string[]>([]);
  const [bulkDatesText, setBulkDatesText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(initialPropertyId ?? ""));

  useEffect(() => {
    fetch("/api/admin/properties", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) =>
        setProperties(
          Array.isArray(data)
            ? data.map((p: any) => ({
                id: p.id,
                name: p.name,
                suburb: p.suburb,
                defaultCleanDurationHours:
                  typeof p?.accessInfo?.defaultCleanDurationHours === "number" ? p.accessInfo.defaultCleanDurationHours : 3,
              }))
            : []
        )
      )
      .catch(() => {});
    fetch("/api/admin/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setClients(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []))
      .catch(() => {});
    fetch(`/api/admin/users?role=CLEANER&includeInactive=1&t=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setCleaners(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Prefill estimated hours from the property's default clean duration.
  useEffect(() => {
    const property = properties.find((row) => row.id === form.propertyId);
    if (!property) return;
    setForm((prev) => ({
      ...prev,
      estimatedHours: property.defaultCleanDurationHours > 0 ? String(property.defaultCleanDurationHours) : prev.estimatedHours,
    }));
  }, [form.propertyId, properties]);

  // Airbnb turnovers always use an existing property; clear turnaround flags off Airbnb.
  useEffect(() => {
    if (form.jobType === AIRBNB_JOB_TYPE) {
      setForm((prev) => (prev.siteMode === "existing_property" ? prev : { ...prev, siteMode: "existing_property" }));
    } else {
      setForm((prev) =>
        prev.earlyCheckin.preset === "none" && prev.lateCheckout.preset === "none"
          ? prev
          : { ...prev, earlyCheckin: { preset: "none", time: "" }, lateCheckout: { preset: "none", time: "" } }
      );
    }
  }, [form.jobType]);

  const isAirbnb = form.jobType === AIRBNB_JOB_TYPE;
  const usesExistingProperty = isAirbnb || form.siteMode === "existing_property";

  const cleanerOptions = useMemo(
    () =>
      cleaners.map((c) => ({
        id: c.id,
        label: c.name ?? c.email ?? c.id,
        hint: c.isActive === false ? "pending / disabled" : undefined,
        disabled: c.isActive === false,
      })),
    [cleaners]
  );
  const propertyChecklist = useMemo(
    () => properties.map((p) => ({ id: p.id, label: `${p.name} (${p.suburb})` })),
    [properties]
  );

  const parsedBulk = useMemo(() => {
    const rawLines = bulkDatesText.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean);
    const valid: Array<{ scheduledDate: string; startTime?: string; dueTime?: string; endTime?: string }> = [];
    const invalid: string[] = [];
    const normTime = (t?: string) => {
      if (!t) return undefined;
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (h < 0 || h > 23 || min < 0 || min > 59) return null;
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    };
    for (const line of rawLines) {
      const t = line.split(/\s+/).filter(Boolean);
      if (t.length === 0 || t.length > 4 || !isValidDate(t[0])) {
        invalid.push(line);
        continue;
      }
      const start = normTime(t[1]);
      const due = normTime(t[2]);
      const end = normTime(t[3]);
      if (start === null || due === null || end === null) {
        invalid.push(line);
        continue;
      }
      valid.push({ scheduledDate: t[0], startTime: start, dueTime: due, endTime: end });
    }
    return { valid, invalid };
  }, [bulkDatesText]);

  function buildPlan() {
    const propertyIds = usesExistingProperty
      ? bulkPropertyIds.length > 0
        ? bulkPropertyIds
        : form.propertyId
          ? [form.propertyId]
          : []
      : ["__service_site__"];
    const lines =
      parsedBulk.valid.length > 0 ? parsedBulk.valid : form.scheduledDate ? [{ scheduledDate: form.scheduledDate }] : [];
    return propertyIds.flatMap((propertyId) =>
      lines.map((line) => ({
        propertyId,
        scheduledDate: line.scheduledDate,
        startTime: (line as any).startTime as string | undefined,
        dueTime: (line as any).dueTime as string | undefined,
        endTime: (line as any).endTime as string | undefined,
      }))
    );
  }

  const plannedCount = buildPlan().length;

  function setTiming(kind: "earlyCheckin" | "lateCheckout", preset: TimingPreset) {
    setForm((prev) => {
      const time = preset === "custom" ? prev[kind].time : preset !== "none" ? preset : "";
      const next: FormState = { ...prev, [kind]: { preset, time } };
      if (kind === "earlyCheckin" && preset !== "none" && time) next.dueTime = time;
      if (kind === "lateCheckout" && preset !== "none" && time) next.startTime = time;
      if (next.startTime && next.dueTime && next.dueTime < next.startTime) next.dueTime = next.startTime;
      return next;
    });
  }

  async function submitJobs(asDraft: boolean) {
    setError(null);
    const plan = buildPlan();
    if (plan.length === 0) {
      setError(usesExistingProperty ? "Choose at least one property and date." : "Add at least one date for this service-site job.");
      return;
    }
    if (parsedBulk.invalid.length > 0) {
      setError("Bulk schedule has invalid rows. Use YYYY-MM-DD or YYYY-MM-DD HH:mm HH:mm [HH:mm].");
      return;
    }
    if (!usesExistingProperty && (!form.siteName.trim() || !form.siteAddress.trim() || !form.siteSuburb.trim())) {
      setError("Service-site name, address, and suburb are required.");
      return;
    }
    if (
      (form.earlyCheckin.preset === "custom" && !form.earlyCheckin.time) ||
      (form.lateCheckout.preset === "custom" && !form.lateCheckout.time)
    ) {
      setError("Custom turnaround times are required.");
      return;
    }
    const defaultEstimatedHours = form.estimatedHours ? Number(form.estimatedHours) : undefined;

    setSaving(true);
    try {
      const created: any[] = [];
      for (const item of plan) {
        const startTime = (item.startTime ?? form.startTime) || undefined;
        const dueTime = (item.dueTime ?? form.dueTime) || undefined;
        const endTime = (item.endTime ?? form.endTime) || undefined;
        if (startTime && dueTime && dueTime < startTime) {
          throw new Error(`Due time must be after start time for ${item.scheduledDate}.`);
        }
        const hasReservation =
          form.guestName || form.reservationCode || form.guestPhone || form.guestEmail || form.guestProfileUrl ||
          form.guestAdults || form.guestChildren || form.guestInfants || form.guestCheckinAtLocal ||
          form.guestCheckoutAtLocal || form.guestLocationText;
        const hasServiceContext =
          !isAirbnb || form.scopeOfWork || form.accessInstructions || form.parkingInstructions || form.hazardNotes ||
          form.equipmentNotes || form.siteContactName || form.siteContactPhone || form.serviceAreaSqm || form.floorCount;

        const payload = {
          propertyId: usesExistingProperty ? item.propertyId : undefined,
          clientId: !usesExistingProperty && form.clientId ? form.clientId : undefined,
          jobType: form.jobType,
          scheduledDate: `${item.scheduledDate}T00:00:00.000Z`,
          startTime,
          dueTime,
          endTime,
          estimatedHours: defaultEstimatedHours,
          notes: form.notes || undefined,
          internalNotes: form.internalNotes || undefined,
          isDraft: asDraft,
          tags: parseTags(form.tagsText),
          attachments: [],
          earlyCheckin: isAirbnb ? apiRule(form.earlyCheckin) : undefined,
          lateCheckout: isAirbnb ? apiRule(form.lateCheckout) : undefined,
          reservationContext: hasReservation
            ? {
                guestName: form.guestName.trim() || undefined,
                reservationCode: form.reservationCode.trim() || undefined,
                guestPhone: form.guestPhone.trim() || undefined,
                guestEmail: form.guestEmail.trim() || undefined,
                guestProfileUrl: form.guestProfileUrl.trim() || undefined,
                adults: form.guestAdults ? Number(form.guestAdults) : undefined,
                children: form.guestChildren ? Number(form.guestChildren) : undefined,
                infants: form.guestInfants ? Number(form.guestInfants) : undefined,
                checkinAtLocal: form.guestCheckinAtLocal ? new Date(form.guestCheckinAtLocal).toISOString() : undefined,
                checkoutAtLocal: form.guestCheckoutAtLocal ? new Date(form.guestCheckoutAtLocal).toISOString() : undefined,
                locationText: form.guestLocationText.trim() || undefined,
              }
            : undefined,
          serviceSite: !usesExistingProperty
            ? {
                name: form.siteName.trim(),
                address: form.siteAddress.trim(),
                suburb: form.siteSuburb.trim(),
                state: form.siteState.trim() || "NSW",
                postcode: form.sitePostcode.trim() || undefined,
                bedrooms: form.siteBedrooms ? Number(form.siteBedrooms) : undefined,
                bathrooms: form.siteBathrooms ? Number(form.siteBathrooms) : undefined,
                hasBalcony: form.siteHasBalcony,
              }
            : undefined,
          serviceContext: hasServiceContext
            ? {
                scopeOfWork: form.scopeOfWork.trim() || undefined,
                accessInstructions: form.accessInstructions.trim() || undefined,
                parkingInstructions: form.parkingInstructions.trim() || undefined,
                hazardNotes: form.hazardNotes.trim() || undefined,
                equipmentNotes: form.equipmentNotes.trim() || undefined,
                siteContactName: form.siteContactName.trim() || undefined,
                siteContactPhone: form.siteContactPhone.trim() || undefined,
                serviceAreaSqm: form.serviceAreaSqm ? Number(form.serviceAreaSqm) : undefined,
                floorCount: form.floorCount ? Number(form.floorCount) : undefined,
              }
            : undefined,
        };
        const res = await fetch("/api/admin/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const createdJob = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(createdJob.error ?? "Failed to create job.");
        if (selectedCleaners.length > 0) {
          const assignRes = await fetch(`/api/admin/jobs/${createdJob.id}/assign`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds: selectedCleaners, primaryUserId: selectedCleaners[0] }),
          });
          const assignBody = await assignRes.json().catch(() => ({}));
          if (!assignRes.ok) throw new Error(assignBody.error ?? "Job created, but assignment failed.");
        }
        created.push(createdJob);
      }
      router.push(created.length === 1 ? `/admin/jobs/${created[0].id}` : "/v2/admin/jobs");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <EAlert tone="danger" title="Could not create">{error}</EAlert> : null}

      {/* Summary strip */}
      <ECard>
        <ECardBody className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="e-eyebrow">Planned jobs</p>
            <p className="e-numeral mt-1 text-[1.75rem] leading-none">{plannedCount}</p>
          </div>
          <div>
            <p className="e-eyebrow">Assignees</p>
            <p className="e-numeral mt-1 text-[1.75rem] leading-none">{selectedCleaners.length}</p>
          </div>
          <div>
            <p className="e-eyebrow">Job type</p>
            <p className="mt-2 text-[0.9375rem] font-[550]">{form.jobType.replace(/_/g, " ")}</p>
          </div>
        </ECardBody>
      </ECard>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Section title="Job details">
            <EField label="Job type" hint="Cleaner forms resolve by job type first, then any property-specific override.">
              <ESelect value={form.jobType} onChange={(e) => setForm((p) => ({ ...p, jobType: e.target.value as JobType }))}>
                {JOB_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </ESelect>
            </EField>

            {!isAirbnb ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <div className="flex flex-wrap items-center gap-4 text-[0.8125rem]">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="site-mode"
                      checked={form.siteMode === "existing_property"}
                      onChange={() => setForm((p) => ({ ...p, siteMode: "existing_property" }))}
                    />
                    Use existing property
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="site-mode"
                      checked={form.siteMode === "service_site"}
                      onChange={() => setForm((p) => ({ ...p, siteMode: "service_site", propertyId: "" }))}
                    />
                    Create a service site for this job
                  </label>
                </div>
              </div>
            ) : null}

            {usesExistingProperty ? (
              <EField label="Property">
                <ESelect value={form.propertyId} onChange={(e) => setForm((p) => ({ ...p, propertyId: e.target.value }))}>
                  <option value="">Select property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.suburb})</option>
                  ))}
                </ESelect>
              </EField>
            ) : (
              <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <EField label="Client (optional)">
                    <ESelect value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}>
                      <option value="">No linked client</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </ESelect>
                  </EField>
                  <EField label="Site name">
                    <EInput value={form.siteName} onChange={(e) => setForm((p) => ({ ...p, siteName: e.target.value }))} placeholder="Bondi Gym — Level 2" />
                  </EField>
                </div>
                <EField label="Service address">
                  <EAddressInput
                    value={form.siteAddress}
                    placeholder="Start typing an address…"
                    onChange={(text) => setForm((p) => ({ ...p, siteAddress: text }))}
                    onSelect={(r) =>
                      setForm((p) => ({
                        ...p,
                        siteAddress: r.formattedAddress,
                        siteSuburb: r.suburb ?? p.siteSuburb,
                        siteState: r.state ?? p.siteState,
                        sitePostcode: r.postcode ?? p.sitePostcode,
                      }))
                    }
                  />
                </EField>
                <div className="grid gap-4 md:grid-cols-3">
                  <EField label="Suburb"><EInput value={form.siteSuburb} onChange={(e) => setForm((p) => ({ ...p, siteSuburb: e.target.value }))} /></EField>
                  <EField label="State"><EInput maxLength={3} value={form.siteState} onChange={(e) => setForm((p) => ({ ...p, siteState: e.target.value.toUpperCase() }))} /></EField>
                  <EField label="Postcode"><EInput inputMode="numeric" maxLength={4} value={form.sitePostcode} onChange={(e) => setForm((p) => ({ ...p, sitePostcode: e.target.value }))} /></EField>
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  <EField label="Bedrooms"><EInput type="number" min="0" value={form.siteBedrooms} onChange={(e) => setForm((p) => ({ ...p, siteBedrooms: e.target.value }))} placeholder="0" /></EField>
                  <EField label="Bathrooms"><EInput type="number" min="0" value={form.siteBathrooms} onChange={(e) => setForm((p) => ({ ...p, siteBathrooms: e.target.value }))} placeholder="0" /></EField>
                  <EField label="Floors / levels"><EInput type="number" min="1" value={form.floorCount} onChange={(e) => setForm((p) => ({ ...p, floorCount: e.target.value }))} placeholder="1" /></EField>
                  <EField label="Service area (sqm)"><EInput type="number" min="0" step="0.5" value={form.serviceAreaSqm} onChange={(e) => setForm((p) => ({ ...p, serviceAreaSqm: e.target.value }))} placeholder="120" /></EField>
                </div>
                <label className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  <input type="checkbox" checked={form.siteHasBalcony} onChange={(e) => setForm((p) => ({ ...p, siteHasBalcony: e.target.checked }))} />
                  Site has balcony / external area
                </label>
              </div>
            )}

            {!isAirbnb ? (
              <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <EField label="On-site contact name"><EInput value={form.siteContactName} onChange={(e) => setForm((p) => ({ ...p, siteContactName: e.target.value }))} placeholder="Building manager / owner / tenant" /></EField>
                  <EField label="On-site contact phone"><EInput type="tel" inputMode="tel" maxLength={20} value={form.siteContactPhone} onChange={(e) => setForm((p) => ({ ...p, siteContactPhone: e.target.value }))} placeholder="0412 345 678" /></EField>
                </div>
                <EField label="Scope of work"><ETextarea value={form.scopeOfWork} onChange={(e) => setForm((p) => ({ ...p, scopeOfWork: e.target.value }))} placeholder="Rooms, surfaces, add-ons, completion standard, keys to collect." /></EField>
                <div className="grid gap-4 md:grid-cols-2">
                  <EField label="Access instructions"><ETextarea value={form.accessInstructions} onChange={(e) => setForm((p) => ({ ...p, accessInstructions: e.target.value }))} placeholder="Reception sign-in, alarm, lift, inductions, key handover." /></EField>
                  <EField label="Parking / arrival notes"><ETextarea value={form.parkingInstructions} onChange={(e) => setForm((p) => ({ ...p, parkingInstructions: e.target.value }))} placeholder="Loading zone, visitor parking, gate code." /></EField>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <EField label="Hazards / safety notes"><ETextarea value={form.hazardNotes} onChange={(e) => setForm((p) => ({ ...p, hazardNotes: e.target.value }))} placeholder="Pets, sharps, mould, restricted areas, chemicals." /></EField>
                  <EField label="Equipment / utilities notes"><ETextarea value={form.equipmentNotes} onChange={(e) => setForm((p) => ({ ...p, equipmentNotes: e.target.value }))} placeholder="Water and power access, onsite equipment, consumables." /></EField>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <EField label="Scheduled date"><EInput type="date" value={form.scheduledDate} onChange={(e) => setForm((p) => ({ ...p, scheduledDate: e.target.value }))} /></EField>
              <EField
                label="Fixed / allocated pay hours"
                hint={usesExistingProperty && form.propertyId ? "Prefilled from the property's default clean duration." : "When set, cleaner pay uses these hours (split across assignees)."}
              >
                <EInput type="number" step="0.25" min="0" value={form.estimatedHours} onChange={(e) => setForm((p) => ({ ...p, estimatedHours: e.target.value }))} />
              </EField>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <EField label="Start time"><EInput type="time" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} /></EField>
              <EField label="Due time"><EInput type="time" value={form.dueTime} onChange={(e) => setForm((p) => ({ ...p, dueTime: e.target.value }))} /></EField>
              <EField label="End time"><EInput type="time" value={form.endTime} onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))} /></EField>
            </div>

            <EField label="Assign cleaners" hint={`${selectedCleaners.length} selected`}>
              <Checklist options={cleanerOptions} selected={selectedCleaners} onChange={setSelectedCleaners} emptyText="No cleaner accounts." />
            </EField>
          </Section>

          {isAirbnb ? (
            <Section title="Turnaround flags">
              <div className="grid gap-4 md:grid-cols-2">
                <EField label="Early check-in">
                  <ESelect value={form.earlyCheckin.preset} onChange={(e) => setTiming("earlyCheckin", e.target.value as TimingPreset)}>
                    <option value="none">None</option>
                    <option value="11:00">Before 11:00 AM</option>
                    <option value="12:30">Before 12:30 PM</option>
                    <option value="custom">Custom</option>
                  </ESelect>
                  {form.earlyCheckin.preset === "custom" ? (
                    <EInput
                      className="mt-2"
                      type="time"
                      value={form.earlyCheckin.time}
                      onChange={(e) => setForm((prev) => {
                        const next = { ...prev, earlyCheckin: { preset: "custom" as const, time: e.target.value } };
                        if (e.target.value) next.dueTime = e.target.value;
                        if (next.startTime && next.dueTime && next.dueTime < next.startTime) next.dueTime = next.startTime;
                        return next;
                      })}
                    />
                  ) : null}
                </EField>
                <EField label="Late checkout">
                  <ESelect value={form.lateCheckout.preset} onChange={(e) => setTiming("lateCheckout", e.target.value as TimingPreset)}>
                    <option value="none">None</option>
                    <option value="12:30">Start after 12:30 PM</option>
                    <option value="custom">Custom</option>
                  </ESelect>
                  {form.lateCheckout.preset === "custom" ? (
                    <EInput
                      className="mt-2"
                      type="time"
                      value={form.lateCheckout.time}
                      onChange={(e) => setForm((prev) => {
                        const next = { ...prev, lateCheckout: { preset: "custom" as const, time: e.target.value } };
                        if (e.target.value) next.startTime = e.target.value;
                        if (next.startTime && next.dueTime && next.dueTime < next.startTime) next.dueTime = next.startTime;
                        return next;
                      })}
                    />
                  ) : null}
                </EField>
              </div>
            </Section>
          ) : null}

          {isAirbnb ? (
            <Section title="Guest / booking details">
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                Optional for manual jobs. iCal-synced turnovers populate these automatically.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <EField label="Guest name"><EInput value={form.guestName} onChange={(e) => setForm((p) => ({ ...p, guestName: e.target.value }))} placeholder="Guest name or booking summary" /></EField>
                <EField label="Reservation code"><EInput value={form.reservationCode} onChange={(e) => setForm((p) => ({ ...p, reservationCode: e.target.value }))} placeholder="ABC12345" /></EField>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <EField label="Adults"><EInput type="number" min="0" value={form.guestAdults} onChange={(e) => setForm((p) => ({ ...p, guestAdults: e.target.value }))} placeholder="2" /></EField>
                <EField label="Children"><EInput type="number" min="0" value={form.guestChildren} onChange={(e) => setForm((p) => ({ ...p, guestChildren: e.target.value }))} placeholder="0" /></EField>
                <EField label="Infants"><EInput type="number" min="0" value={form.guestInfants} onChange={(e) => setForm((p) => ({ ...p, guestInfants: e.target.value }))} placeholder="0" /></EField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <EField label="Guest phone"><EInput type="tel" inputMode="tel" maxLength={20} value={form.guestPhone} onChange={(e) => setForm((p) => ({ ...p, guestPhone: e.target.value }))} placeholder="+61..." /></EField>
                <EField label="Guest email"><EInput type="email" value={form.guestEmail} onChange={(e) => setForm((p) => ({ ...p, guestEmail: e.target.value }))} placeholder="guest@example.com" /></EField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <EField label="Check-in"><EInput type="datetime-local" value={form.guestCheckinAtLocal} onChange={(e) => setForm((p) => ({ ...p, guestCheckinAtLocal: e.target.value }))} /></EField>
                <EField label="Checkout"><EInput type="datetime-local" value={form.guestCheckoutAtLocal} onChange={(e) => setForm((p) => ({ ...p, guestCheckoutAtLocal: e.target.value }))} /></EField>
              </div>
              <EField label="Guest profile URL"><EInput value={form.guestProfileUrl} onChange={(e) => setForm((p) => ({ ...p, guestProfileUrl: e.target.value }))} placeholder="https://..." /></EField>
              <EField label="Booking location / extra details"><ETextarea value={form.guestLocationText} onChange={(e) => setForm((p) => ({ ...p, guestLocationText: e.target.value }))} placeholder="Imported location, booking notes, or relevant guest details." /></EField>
            </Section>
          ) : null}

          <Section title="Notes & tags">
            <EField label="Tags" hint="Comma-separated"><EInput value={form.tagsText} onChange={(e) => setForm((p) => ({ ...p, tagsText: e.target.value }))} placeholder="priority, VIP guest, keys" /></EField>
            <EField label="Cleaner notes"><ETextarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} /></EField>
            <EField label="Internal notes"><ETextarea value={form.internalNotes} onChange={(e) => setForm((p) => ({ ...p, internalNotes: e.target.value }))} /></EField>
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              File attachments and saved templates remain in the classic builder.
            </p>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Bulk create">
            {usesExistingProperty ? (
              <EField label="Bulk properties" hint="Leave empty to use the single property above.">
                <Checklist options={propertyChecklist} selected={bulkPropertyIds} onChange={setBulkPropertyIds} emptyText="No properties." />
              </EField>
            ) : (
              <p className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                Service-site jobs can span multiple dates below. The same site details are reused for each planned job.
              </p>
            )}
            <EField label="Bulk schedule lines" hint="Per line: YYYY-MM-DD [start HH:mm] [due HH:mm] [end HH:mm].">
              <ETextarea
                value={bulkDatesText}
                onChange={(e) => setBulkDatesText(e.target.value)}
                placeholder={"2026-03-05\n2026-03-06 10:00 15:00\n2026-03-07 12:30 16:30 17:00"}
                className="min-h-[6rem]"
              />
            </EField>
            {parsedBulk.invalid.length > 0 ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">
                {parsedBulk.invalid.length} invalid line(s) must be fixed before creating jobs.
              </p>
            ) : null}
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              {plannedCount === 0
                ? usesExistingProperty ? "Choose a property and date." : "Choose at least one date."
                : plannedCount === 1 ? "One job will be created." : `${plannedCount} jobs will be created.`}
            </p>
          </Section>

          <Section title="Status">
            <ESwitch checked={form.isDraft} onCheckedChange={(v) => setForm((p) => ({ ...p, isDraft: v }))} label="Mark as draft by default" />
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              <p>{parseTags(form.tagsText).length} tag(s)</p>
              <p>{form.isDraft ? "Draft mode enabled" : "Draft mode disabled"}</p>
              <p>{selectedCleaners.length} assignee(s)</p>
            </div>
            <div className="grid gap-2">
              <EButton onClick={() => submitJobs(form.isDraft)} disabled={saving}>
                {saving ? "Saving…" : plannedCount > 1 ? "Create planned jobs" : "Create job"}
              </EButton>
              <EButton variant="outline" onClick={() => submitJobs(true)} disabled={saving}>Save as draft</EButton>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
