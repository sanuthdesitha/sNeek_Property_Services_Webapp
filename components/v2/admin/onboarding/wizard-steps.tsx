"use client";

/**
 * ESTATE onboarding wizard steps — v2-native ports of the v1 step components
 * (components/onboarding/step-*.tsx). Every step is a controlled fragment over
 * the shared wizard formData blob; payload keys match the zod schemas in
 * lib/validations/onboarding.ts exactly (top-level survey scalars, nested
 * appliances / specialRequests / laundryDetail / accessDetails arrays, and the
 * formMeta envelope keys: selectedJobTypes / scenarios / recurringSchedule /
 * emergencyContact / defaultCheckinTime / defaultCheckoutTime / geocode).
 * Estate token scope only; no components/ui/* dependency.
 */
import * as React from "react";
import { CheckCircle2, Loader2, Plus, Trash2, Upload, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "./address-input";

export interface StepProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export const CHECKBOX_CLASS =
  "h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))] rounded border-[hsl(var(--e-border-strong))]";

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
      {title ? <h3 className="mb-3 text-[0.8125rem] font-[600]">{title}</h3> : null}
      {children}
    </section>
  );
}

function ECheckboxRow({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        className={CHECKBOX_CLASS}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{label}</span>
    </label>
  );
}

/* ── Step 1: Client ─────────────────────────────────────────────────────── */
interface ClientOption {
  id: string;
  name: string;
  email: string;
}

export function StepClient({ data, onChange }: StepProps) {
  const [clients, setClients] = React.useState<ClientOption[]>([]);
  const [search, setSearch] = React.useState("");
  const isNewClient = data.isNewClient === true;

  React.useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        if (Array.isArray(rows)) {
          setClients(rows.map((r: any) => ({ id: r.id, name: r.name, email: r.email })));
        }
      })
      .catch(() => setClients([]));
  }, []);

  const filteredClients = clients.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const clientData = (data.clientData as Record<string, unknown>) ?? {};
  const setClient = (patch: Record<string, unknown>) =>
    onChange({ ...data, clientData: { ...clientData, ...patch } });

  return (
    <div className="space-y-4">
      <ECheckboxRow
        checked={isNewClient}
        onChange={(v) => onChange({ ...data, isNewClient: v })}
        label="Create a new client (uncheck to link existing)"
      />

      {isNewClient ? (
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Client name *">
            <EInput
              value={String(clientData.name ?? "")}
              onChange={(e) => setClient({ name: e.target.value })}
              placeholder="Full name or company"
            />
          </EField>
          <EField label="Email">
            <EInput
              type="email"
              value={String(clientData.email ?? "")}
              onChange={(e) => setClient({ email: e.target.value })}
              placeholder="client@example.com"
            />
          </EField>
          <EField label="Phone">
            <EInput
              value={String(clientData.phone ?? "")}
              onChange={(e) => setClient({ phone: e.target.value })}
              placeholder="04XX XXX XXX"
            />
          </EField>
          <EField label="Address">
            <EAddressInput
              value={String(clientData.address ?? "")}
              placeholder="Client address"
              onChange={(text) => setClient({ address: text })}
              onSelect={(r) =>
                setClient({
                  address: r.formattedAddress,
                  suburb: r.suburb ?? clientData.suburb,
                  state: r.state ?? clientData.state,
                  postcode: r.postcode ?? clientData.postcode,
                  latitude: r.lat,
                  longitude: r.lng,
                  placeId: r.placeId,
                })
              }
            />
          </EField>
          <EField label="Notes" className="md:col-span-2">
            <ETextarea
              value={String(clientData.notes ?? "")}
              onChange={(e) => setClient({ notes: e.target.value })}
              placeholder="Any notes about this client"
            />
          </EField>
        </div>
      ) : (
        <div className="space-y-3">
          <EField label="Search existing client">
            <EInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type to search by name or email"
            />
          </EField>
          {search && filteredClients.length > 0 ? (
            <div className="max-h-48 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              {filteredClients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => onChange({ ...data, existingClientId: client.id })}
                  className={`w-full px-3 py-2 text-left text-[0.8125rem] transition-colors hover:bg-[hsl(var(--e-primary-soft)/0.35)] ${
                    data.existingClientId === client.id ? "bg-[hsl(var(--e-gold-soft))] font-[600]" : ""
                  }`}
                >
                  {client.name}
                  {client.email ? (
                    <span className="ml-2 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">({client.email})</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {typeof data.existingClientId === "string" && data.existingClientId ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-success))]">
              Linked to: {clients.find((c) => c.id === data.existingClientId)?.name ?? data.existingClientId}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Step 2: Property basics ────────────────────────────────────────────── */
const PROPERTY_TYPES = [
  { value: "HOUSE", label: "House" },
  { value: "APARTMENT", label: "Apartment" },
  { value: "UNIT", label: "Unit" },
  { value: "TOWNHOUSE", label: "Townhouse" },
  { value: "DUPLEX", label: "Duplex" },
];

const STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

export function StepPropertyBasics({ data, onChange }: StepProps) {
  const update = (key: string, value: unknown) => onChange({ ...data, [key]: value });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EField label="Property name / identifier *" className="md:col-span-2">
        <EInput
          value={String(data.propertyName ?? "")}
          onChange={(e) => update("propertyName", e.target.value)}
          placeholder="e.g., 42 Smith St - Johnson"
        />
      </EField>
      <EField label="Address *" className="md:col-span-2">
        <EAddressInput
          value={String(data.propertyAddress ?? "")}
          placeholder="Full street address"
          onChange={(text) => update("propertyAddress", text)}
          onSelect={(r) =>
            onChange({
              ...data,
              propertyAddress: r.formattedAddress,
              propertySuburb: r.suburb ?? data.propertySuburb ?? "",
              propertyState: r.state ?? data.propertyState ?? "NSW",
              propertyPostcode: r.postcode ?? data.propertyPostcode ?? "",
              propertyLatitude: r.lat,
              propertyLongitude: r.lng,
              propertyPlaceId: r.placeId,
            })
          }
        />
      </EField>
      <EField label="Suburb">
        <EInput
          value={String(data.propertySuburb ?? "")}
          onChange={(e) => update("propertySuburb", e.target.value)}
          placeholder="Suburb"
        />
      </EField>
      <EField label="State">
        <ESelect value={String(data.propertyState ?? "NSW")} onChange={(e) => update("propertyState", e.target.value)}>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </ESelect>
      </EField>
      <EField label="Postcode">
        <EInput
          value={String(data.propertyPostcode ?? "")}
          onChange={(e) => update("propertyPostcode", e.target.value)}
          placeholder="2000"
        />
      </EField>
      <EField label="Property type">
        <ESelect value={String(data.propertyType ?? "")} onChange={(e) => update("propertyType", e.target.value || null)}>
          <option value="">Select type</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </ESelect>
      </EField>
      <EField label="Bedrooms">
        <EInput
          type="number"
          min={0}
          max={50}
          className="tabular-nums"
          value={Number(data.bedrooms ?? 1)}
          onChange={(e) => update("bedrooms", parseInt(e.target.value) || 0)}
        />
      </EField>
      <EField label="Bathrooms">
        <EInput
          type="number"
          min={0}
          max={50}
          className="tabular-nums"
          value={Number(data.bathrooms ?? 1)}
          onChange={(e) => update("bathrooms", parseInt(e.target.value) || 0)}
        />
      </EField>
      <EField label="Floor count">
        <EInput
          type="number"
          min={1}
          max={20}
          className="tabular-nums"
          value={Number(data.floorCount ?? 1)}
          onChange={(e) => update("floorCount", parseInt(e.target.value) || 1)}
        />
      </EField>
      <EField label="Size (sqm)">
        <EInput
          type="number"
          min={0}
          max={50000}
          className="tabular-nums"
          value={data.sizeSqm ? String(data.sizeSqm) : ""}
          onChange={(e) => update("sizeSqm", e.target.value ? parseFloat(e.target.value) : null)}
          placeholder="Leave blank to estimate"
        />
      </EField>
      <div className="flex items-center pt-5">
        <ECheckboxRow
          checked={data.hasBalcony === true}
          onChange={(v) => update("hasBalcony", v)}
          label="Has balcony"
        />
      </div>
      <EField label="Property notes" className="md:col-span-2">
        <ETextarea
          value={String(data.propertyNotes ?? "")}
          onChange={(e) => update("propertyNotes", e.target.value)}
          placeholder="Any general notes about the property"
        />
      </EField>
    </div>
  );
}

/* ── Step 3: Access details ─────────────────────────────────────────────── */
const DETAIL_TYPES = [
  { value: "LOCKBOX", label: "Lockbox code" },
  { value: "KEY_LOCATION", label: "Key location" },
  { value: "PARKING", label: "Parking instructions" },
  { value: "BUILDING_ACCESS", label: "Building access" },
  { value: "ENTRY_PHOTO", label: "Entry photo" },
];

interface AccessDetail {
  detailType: string;
  value: string;
  photoUrl: string;
  photoKey: string;
  sortOrder: number;
}

export function StepAccess({ data, onChange }: StepProps) {
  const [uploading, setUploading] = React.useState(false);
  const details: AccessDetail[] = (data.accessDetails as AccessDetail[]) ?? [];

  const addDetail = (type: string) => {
    onChange({
      ...data,
      accessDetails: [
        ...details,
        { detailType: type, value: "", photoUrl: "", photoKey: "", sortOrder: details.length },
      ],
    });
  };

  const updateDetail = (index: number, patch: Partial<AccessDetail>) => {
    const updated = [...details];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...data, accessDetails: updated });
  };

  const removeDetail = (index: number) => {
    onChange({ ...data, accessDetails: details.filter((_, i) => i !== index) });
  };

  const uploadPhoto = async (file: File, index: number) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "onboarding-access");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Upload failed");
      updateDetail(index, { photoUrl: body.url, photoKey: body.key });
      toast({ title: "Photo uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className={MUTED}>Add access details: lockbox codes, key locations, parking instructions, and entry photos.</p>

      {details.length === 0 ? (
        <div className="rounded-[var(--e-radius-lg)] border-2 border-dashed border-[hsl(var(--e-border-strong))] p-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          No access details added yet.
        </div>
      ) : null}

      {details.map((detail, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
          <div className="flex items-center gap-2">
            <ESelect
              className="w-[220px]"
              value={detail.detailType}
              onChange={(e) => updateDetail(i, { detailType: e.target.value })}
            >
              {DETAIL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </ESelect>
            <EButton variant="ghost" size="icon" aria-label="Remove access detail" onClick={() => removeDetail(i)}>
              <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
            </EButton>
          </div>

          {detail.detailType === "ENTRY_PHOTO" ? (
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-3 py-2 text-[0.75rem] transition-colors hover:bg-[hsl(var(--e-muted))]">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload photo"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.[0]) void uploadPhoto(e.target.files[0], i);
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              {detail.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={detail.photoUrl}
                  alt="Access"
                  className="max-h-48 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
                />
              ) : null}
            </div>
          ) : (
            <ETextarea
              value={detail.value}
              onChange={(e) => updateDetail(i, { value: e.target.value })}
              placeholder={`Enter ${DETAIL_TYPES.find((t) => t.value === detail.detailType)?.label?.toLowerCase() ?? "details"}`}
            />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {DETAIL_TYPES.map((t) => (
          <EButton key={t.value} variant="outline" size="sm" onClick={() => addDetail(t.value)}>
            <Plus className="h-3.5 w-3.5" /> {t.label}
          </EButton>
        ))}
      </div>
    </div>
  );
}

/* ── Step 4: Cleaning types ─────────────────────────────────────────────── */
export const JOB_TYPES = [
  { value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" },
  { value: "DEEP_CLEAN", label: "Deep Clean" },
  { value: "END_OF_LEASE", label: "End of Lease" },
  { value: "MOVE_IN_CLEAN", label: "Move-in Clean" },
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

export function StepJobTypes({ data, onChange }: StepProps) {
  const selectedJobTypes = (data.selectedJobTypes as string[]) ?? [];
  const scenarios = (data.scenarios as Record<string, unknown>) ?? {};

  const toggleJobType = (jobType: string) => {
    const updated = selectedJobTypes.includes(jobType)
      ? selectedJobTypes.filter((jt) => jt !== jobType)
      : [...selectedJobTypes, jobType];
    onChange({ ...data, selectedJobTypes: updated });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[0.8125rem] font-[600]">Select cleaning types needed</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {JOB_TYPES.map((jt) => (
            <label
              key={jt.value}
              className={`flex items-center gap-2 rounded-[var(--e-radius)] border p-2 text-[0.8125rem] transition-colors ${
                selectedJobTypes.includes(jt.value)
                  ? "border-[hsl(var(--e-border-gold)/0.6)] bg-[hsl(var(--e-gold-soft))]"
                  : "border-[hsl(var(--e-border))]"
              }`}
            >
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={selectedJobTypes.includes(jt.value)}
                onChange={() => toggleJobType(jt.value)}
              />
              {jt.label}
            </label>
          ))}
        </div>
      </div>

      <EField label="Additional notes for selected types">
        <ETextarea
          value={String(scenarios.jobTypeNotes ?? "")}
          onChange={(e) => onChange({ ...data, scenarios: { ...scenarios, jobTypeNotes: e.target.value } })}
          placeholder="Any specific instructions for the selected cleaning types"
          rows={4}
        />
      </EField>

      {selectedJobTypes.length > 0 ? (
        <p className={MUTED}>
          {selectedJobTypes.length} cleaning type{selectedJobTypes.length !== 1 ? "s" : ""} selected.
        </p>
      ) : null}
    </div>
  );
}

/* ── Step 5: Appliances ─────────────────────────────────────────────────── */
const APPLIANCE_TYPES = ["OVEN", "FRIDGE", "DISHWASHER", "WASHER", "DRYER", "RANGEHOOD", "MICROWAVE", "OTHER"];

interface Appliance {
  applianceType: string;
  conditionNote: string;
  requiresClean: boolean;
}

export function StepAppliances({ data, onChange }: StepProps) {
  const appliances: Appliance[] = (data.appliances as Appliance[]) ?? [];

  const addAppliance = () => {
    onChange({
      ...data,
      appliances: [...appliances, { applianceType: "OVEN", conditionNote: "", requiresClean: true }],
    });
  };

  const updateAppliance = (index: number, patch: Partial<Appliance>) => {
    const updated = [...appliances];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...data, appliances: updated });
  };

  const removeAppliance = (index: number) => {
    onChange({ ...data, appliances: appliances.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className={MUTED}>List any special appliances that need cleaning (oven, fridge, etc.).</p>

      {appliances.length === 0 ? (
        <div className="rounded-[var(--e-radius-lg)] border-2 border-dashed border-[hsl(var(--e-border-strong))] p-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          No appliances added yet. Click &quot;Add appliance&quot; to start.
        </div>
      ) : null}

      {appliances.map((appliance, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4 md:flex-row md:items-end"
        >
          <EField label="Type" className="flex-1">
            <ESelect
              value={appliance.applianceType}
              onChange={(e) => updateAppliance(i, { applianceType: e.target.value })}
            >
              {APPLIANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Condition note" className="flex-[2]">
            <ETextarea
              value={appliance.conditionNote}
              onChange={(e) => updateAppliance(i, { conditionNote: e.target.value })}
              placeholder="e.g., Heavy grease buildup"
              rows={1}
              className="min-h-[2.5rem]"
            />
          </EField>
          <div className="flex items-center gap-2 pb-2">
            <ECheckboxRow
              checked={appliance.requiresClean}
              onChange={(v) => updateAppliance(i, { requiresClean: v })}
              label="Clean"
            />
          </div>
          <EButton variant="ghost" size="icon" aria-label="Remove appliance" onClick={() => removeAppliance(i)}>
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        </div>
      ))}

      <EButton variant="outline" size="sm" onClick={addAppliance}>
        <Plus className="h-3.5 w-3.5" /> Add appliance
      </EButton>
    </div>
  );
}

/* ── Step 6: Laundry ────────────────────────────────────────────────────── */
interface Supplier {
  id: string;
  name: string;
  pricePerKg: number | null;
  avgTurnaround: number | null;
}

export function StepLaundry({ data, onChange }: StepProps) {
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const laundry = (data.laundryDetail as Record<string, unknown>) ?? {};
  const update = (key: string, value: unknown) =>
    onChange({ ...data, laundryDetail: { ...laundry, [key]: value } });

  React.useEffect(() => {
    fetch("/api/admin/laundry/suppliers")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        if (Array.isArray(rows)) setSuppliers(rows.filter((s: any) => s.isActive !== false));
      })
      .catch(() => setSuppliers([]));
  }, []);

  const selectedSupplier = suppliers.find((s) => s.id === data.laundrySupplierId);

  return (
    <div className="space-y-4">
      <ECheckboxRow
        checked={laundry.hasLaundry === true}
        onChange={(v) => update("hasLaundry", v)}
        label="Property has laundry"
      />

      {laundry.hasLaundry === true ? (
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Assign laundry partner" className="md:col-span-2">
            <ESelect
              value={data.laundrySupplierId ? String(data.laundrySupplierId) : ""}
              onChange={(e) => onChange({ ...data, laundrySupplierId: e.target.value || null })}
            >
              <option value="">No partner assigned</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.pricePerKg ? ` — $${s.pricePerKg.toFixed(2)}/kg` : ""}
                  {s.avgTurnaround ? ` — ${s.avgTurnaround}h turnaround` : ""}
                </option>
              ))}
            </ESelect>
            {selectedSupplier ? (
              <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                {selectedSupplier.name}
                {selectedSupplier.pricePerKg ? ` · $${selectedSupplier.pricePerKg.toFixed(2)}/kg` : ""}
                {selectedSupplier.avgTurnaround ? ` · ${selectedSupplier.avgTurnaround}h avg turnaround` : ""}
              </p>
            ) : null}
          </EField>
          <EField label="Washer type">
            <ESelect value={String(laundry.washerType ?? "")} onChange={(e) => update("washerType", e.target.value || null)}>
              <option value="">Select</option>
              {["FRONT_LOAD", "TOP_LOAD", "COMBO"].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Dryer type">
            <ESelect value={String(laundry.dryerType ?? "")} onChange={(e) => update("dryerType", e.target.value || null)}>
              <option value="">Select</option>
              {["DRYER", "COMBO", "NONE"].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Laundry location">
            <ESelect
              value={String(laundry.laundryLocation ?? "")}
              onChange={(e) => update("laundryLocation", e.target.value || null)}
            >
              <option value="">Select</option>
              {["INSIDE_UNIT", "SEPARATE_ROOM", "GARAGE", "OUTDOOR"].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Detergent type">
            <ESelect
              value={String(laundry.detergentType ?? "")}
              onChange={(e) => update("detergentType", e.target.value || null)}
            >
              <option value="">Select</option>
              {["STANDARD", "HYPOALLERGENIC", "ECO", "CLIENT_PROVIDED"].map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </ESelect>
          </EField>
          <div className="flex items-center">
            <ECheckboxRow
              checked={laundry.suppliesProvided === true}
              onChange={(v) => update("suppliesProvided", v)}
              label="Supplies provided by client"
            />
          </div>
          <EField label="Laundry notes" className="md:col-span-2">
            <ETextarea
              value={String(laundry.notes ?? "")}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Any laundry-specific instructions"
            />
          </EField>
        </div>
      ) : null}
    </div>
  );
}

/* ── Step 7: Scenarios & consumables ────────────────────────────────────── */
const CADENCES = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "FORTNIGHTLY", label: "Fortnightly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "ON_DEMAND", label: "On demand" },
  { value: "CUSTOM", label: "Custom" },
];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function StepScenarios({ data, onChange }: StepProps) {
  const scenarios = (data.scenarios as Record<string, unknown>) ?? {};
  const schedule = (data.recurringSchedule as Record<string, unknown>) ?? {};
  const contact = (data.emergencyContact as Record<string, unknown>) ?? {};

  const setScenario = (key: string, value: unknown) =>
    onChange({ ...data, scenarios: { ...scenarios, [key]: value } });
  const setSchedule = (key: string, value: unknown) =>
    onChange({ ...data, recurringSchedule: { ...schedule, [key]: value } });
  const setContact = (key: string, value: unknown) =>
    onChange({ ...data, emergencyContact: { ...contact, [key]: value } });

  return (
    <div className="space-y-5">
      <SectionCard title="Rooms & beds">
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Bed configuration">
            <EInput
              value={String(scenarios.bedConfig ?? "")}
              onChange={(e) => setScenario("bedConfig", e.target.value)}
              placeholder="e.g. 1x King, 2x Queen, 2x Single"
            />
          </EField>
          <EField label="Total beds">
            <EInput
              type="number"
              min={0}
              className="tabular-nums"
              value={scenarios.bedCount != null ? String(scenarios.bedCount) : ""}
              onChange={(e) => setScenario("bedCount", e.target.value ? parseInt(e.target.value) : null)}
            />
          </EField>
        </div>
      </SectionCard>

      <SectionCard title="Check-in / check-out windows">
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Default check-in time">
            <EInput
              type="time"
              className="tabular-nums"
              value={String(data.defaultCheckinTime ?? "14:00")}
              onChange={(e) => onChange({ ...data, defaultCheckinTime: e.target.value })}
            />
          </EField>
          <EField label="Default check-out time">
            <EInput
              type="time"
              className="tabular-nums"
              value={String(data.defaultCheckoutTime ?? "10:00")}
              onChange={(e) => onChange({ ...data, defaultCheckoutTime: e.target.value })}
            />
          </EField>
        </div>
      </SectionCard>

      <SectionCard title="Pets, security & connectivity">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center">
            <ECheckboxRow
              checked={scenarios.hasPets === true}
              onChange={(v) => setScenario("hasPets", v)}
              label="Property has pets"
            />
          </div>
          <EField label="Pet details" className={scenarios.hasPets === true ? "" : "opacity-50"}>
            <EInput
              disabled={scenarios.hasPets !== true}
              value={String(scenarios.petDetails ?? "")}
              onChange={(e) => setScenario("petDetails", e.target.value)}
              placeholder="e.g. 1 cat (indoor), allergy-safe products"
            />
          </EField>
          <div className="flex items-center">
            <ECheckboxRow
              checked={scenarios.hasAlarm === true}
              onChange={(v) => setScenario("hasAlarm", v)}
              label="Property has a security alarm"
            />
          </div>
          <EField label="Alarm code / disarm steps" className={scenarios.hasAlarm === true ? "" : "opacity-50"}>
            <EInput
              className="tabular-nums"
              disabled={scenarios.hasAlarm !== true}
              value={String(scenarios.alarmCode ?? "")}
              onChange={(e) => setScenario("alarmCode", e.target.value)}
              placeholder="Stored encrypted on the property"
            />
          </EField>
          <EField
            label="Alarm notes"
            className={scenarios.hasAlarm === true ? "md:col-span-2" : "md:col-span-2 opacity-50"}
          >
            <EInput
              disabled={scenarios.hasAlarm !== true}
              value={String(scenarios.alarmNotes ?? "")}
              onChange={(e) => setScenario("alarmNotes", e.target.value)}
              placeholder="e.g. 30s entry delay, panel by front door"
            />
          </EField>
          <EField label="Wifi network">
            <EInput
              value={String(scenarios.wifiNetwork ?? "")}
              onChange={(e) => setScenario("wifiNetwork", e.target.value)}
            />
          </EField>
          <EField label="Wifi password">
            <EInput
              value={String(scenarios.wifiPassword ?? "")}
              onChange={(e) => setScenario("wifiPassword", e.target.value)}
            />
          </EField>
        </div>
      </SectionCard>

      <SectionCard title="Bins, consumables & linen">
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Bin / recycling day">
            <EInput
              value={String(scenarios.binDay ?? "")}
              onChange={(e) => setScenario("binDay", e.target.value)}
              placeholder="e.g. Tue general, alt-Wed recycling"
            />
          </EField>
          <EField label="Bin notes">
            <EInput
              value={String(scenarios.binNotes ?? "")}
              onChange={(e) => setScenario("binNotes", e.target.value)}
              placeholder="Where bins live, who takes them out"
            />
          </EField>
          <div className="flex items-center">
            <ECheckboxRow
              checked={scenarios.consumablesProvided === true}
              onChange={(v) => setScenario("consumablesProvided", v)}
              label="Consumables provided by us (restock)"
            />
          </div>
          <div />
          <EField label="Linen sets on site">
            <EInput
              type="number"
              min={0}
              className="tabular-nums"
              value={scenarios.linenSets != null ? String(scenarios.linenSets) : ""}
              onChange={(e) => setScenario("linenSets", e.target.value ? parseInt(e.target.value) : null)}
            />
          </EField>
          <EField label="Linen buffer / par sets">
            <EInput
              type="number"
              min={0}
              className="tabular-nums"
              value={scenarios.linenBufferSets != null ? String(scenarios.linenBufferSets) : ""}
              onChange={(e) => setScenario("linenBufferSets", e.target.value ? parseInt(e.target.value) : null)}
            />
          </EField>
          <EField label="Consumables / restock expectations" className="md:col-span-2">
            <ETextarea
              value={String(scenarios.restockExpectations ?? "")}
              onChange={(e) => setScenario("restockExpectations", e.target.value)}
              placeholder="Toilet paper, soap, coffee pods, welcome amenities, who restocks…"
            />
          </EField>
        </div>
      </SectionCard>

      <SectionCard title="No-go areas & boundaries">
        <ETextarea
          value={String(scenarios.noGoAreas ?? "")}
          onChange={(e) => setScenario("noGoAreas", e.target.value)}
          placeholder="Locked owner's closet, garage off-limits, do not touch personal items in master, etc."
        />
      </SectionCard>

      <SectionCard title="Recurring schedule">
        <div className="mb-3">
          <ECheckboxRow
            checked={schedule.enabled === true}
            onChange={(v) => setSchedule("enabled", v)}
            label="This property has a recurring clean"
          />
        </div>
        {schedule.enabled === true ? (
          <div className="grid gap-4 md:grid-cols-3">
            <EField label="Cadence">
              <ESelect value={String(schedule.cadence ?? "")} onChange={(e) => setSchedule("cadence", e.target.value || null)}>
                <option value="">Select</option>
                {CADENCES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Preferred day">
              <ESelect
                value={schedule.dayOfWeek != null ? String(schedule.dayOfWeek) : ""}
                onChange={(e) => setSchedule("dayOfWeek", e.target.value === "" ? null : parseInt(e.target.value))}
              >
                <option value="">Any</option>
                {DAYS.map((d, i) => (
                  <option key={d} value={String(i)}>
                    {d}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Preferred time">
              <EInput
                type="time"
                className="tabular-nums"
                value={String(schedule.preferredTime ?? "")}
                onChange={(e) => setSchedule("preferredTime", e.target.value || null)}
              />
            </EField>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Emergency / owner contact">
        <div className="grid gap-4 md:grid-cols-2">
          <EField label="Contact name">
            <EInput value={String(contact.name ?? "")} onChange={(e) => setContact("name", e.target.value)} />
          </EField>
          <EField label="Phone">
            <EInput
              value={String(contact.phone ?? "")}
              onChange={(e) => setContact("phone", e.target.value)}
              placeholder="04XX XXX XXX"
            />
          </EField>
          <EField label="Relationship">
            <EInput
              value={String(contact.relation ?? "")}
              onChange={(e) => setContact("relation", e.target.value)}
              placeholder="Owner, property manager…"
            />
          </EField>
          <EField label="Email">
            <EInput type="email" value={String(contact.email ?? "")} onChange={(e) => setContact("email", e.target.value)} />
          </EField>
        </div>
      </SectionCard>
    </div>
  );
}

/* ── Step 8: Special requests ───────────────────────────────────────────── */
const AREAS = ["KITCHEN", "BATHROOM", "BEDROOM", "LIVING", "OUTDOOR", "GARAGE", "WHOLE_PROPERTY", "OTHER"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

interface SpecialRequest {
  description: string;
  priority: string;
  area: string;
}

export function StepRequests({ data, onChange }: StepProps) {
  const requests: SpecialRequest[] = (data.specialRequests as SpecialRequest[]) ?? [];

  const addRequest = () => {
    onChange({
      ...data,
      specialRequests: [...requests, { description: "", priority: "NORMAL", area: "" }],
    });
  };

  const updateRequest = (index: number, patch: Partial<SpecialRequest>) => {
    const updated = [...requests];
    updated[index] = { ...updated[index], ...patch };
    onChange({ ...data, specialRequests: updated });
  };

  const removeRequest = (index: number) => {
    onChange({ ...data, specialRequests: requests.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <p className={MUTED}>Any special cleaning requests from the client beyond the standard checklist.</p>

      {requests.length === 0 ? (
        <div className="rounded-[var(--e-radius-lg)] border-2 border-dashed border-[hsl(var(--e-border-strong))] p-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          No special requests yet.
        </div>
      ) : null}

      {requests.map((req, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4 md:flex-row md:items-end"
        >
          <EField label="Description" className="flex-[3]">
            <ETextarea
              value={req.description}
              onChange={(e) => updateRequest(i, { description: e.target.value })}
              placeholder="Describe the special request"
              rows={1}
              className="min-h-[2.5rem]"
            />
          </EField>
          <EField label="Area" className="flex-1">
            <ESelect value={req.area} onChange={(e) => updateRequest(i, { area: e.target.value })}>
              <option value="">Area</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/_/g, " ")}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Priority" className="flex-1">
            <ESelect value={req.priority} onChange={(e) => updateRequest(i, { priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </ESelect>
          </EField>
          <EButton variant="ghost" size="icon" aria-label="Remove request" onClick={() => removeRequest(i)}>
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        </div>
      ))}

      <EButton variant="outline" size="sm" onClick={addRequest}>
        <Plus className="h-3.5 w-3.5" /> Add request
      </EButton>
    </div>
  );
}

/* ── Step 9: Notes ──────────────────────────────────────────────────────── */
export function StepNotes({ data, onChange }: StepProps) {
  const scenarios = (data.scenarios as Record<string, unknown>) ?? {};
  const setScenario = (key: string, value: unknown) =>
    onChange({ ...data, scenarios: { ...scenarios, [key]: value } });

  return (
    <div className="grid gap-4">
      <EField label="Parking instructions">
        <ETextarea
          value={String(scenarios.parkingInstructions ?? "")}
          onChange={(e) => setScenario("parkingInstructions", e.target.value)}
          placeholder="Where should cleaners park? Any permits needed?"
        />
      </EField>
      <EField label="Timing instructions">
        <ETextarea
          value={String(scenarios.timingInstructions ?? "")}
          onChange={(e) => setScenario("timingInstructions", e.target.value)}
          placeholder="Preferred cleaning times, noise restrictions, etc."
        />
      </EField>
      <EField label="Special notes">
        <ETextarea
          value={String(scenarios.specialNotes ?? "")}
          onChange={(e) => setScenario("specialNotes", e.target.value)}
          placeholder="Any other important information for cleaners"
          rows={4}
        />
      </EField>
    </div>
  );
}

/* ── Step 10: Staffing & estimate ───────────────────────────────────────── */
interface EstimationResult {
  estimatedHours: number;
  suggestedCleanerCount: number;
  estimatedPrice: number;
  priceBreakdown: { label: string; amount: number }[];
  confidence: string;
  warnings: string[];
}

export function StepStaffing({ data, onChange }: StepProps) {
  const [estimation, setEstimation] = React.useState<EstimationResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const dataRef = React.useRef(data);
  dataRef.current = data;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      void fetchEstimation();
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data.bedrooms,
    data.bathrooms,
    data.hasBalcony,
    data.floorCount,
    data.propertyType,
    data.sizeSqm,
    data.selectedJobTypes,
  ]);

  async function fetchEstimation() {
    const current = dataRef.current;
    const appliances = (current.appliances as any[]) ?? [];
    const specialRequests = (current.specialRequests as any[]) ?? [];

    setLoading(true);
    try {
      const res = await fetch("/api/admin/onboarding/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bedrooms: Number(current.bedrooms ?? 1),
          bathrooms: Number(current.bathrooms ?? 1),
          hasBalcony: current.hasBalcony === true,
          floorCount: Number(current.floorCount ?? 1),
          propertyType: current.propertyType ?? null,
          sizeSqm: current.sizeSqm ? Number(current.sizeSqm) : null,
          applianceCount: appliances.length,
          specialRequestCount: specialRequests.length,
          conditionLevel: current.conditionLevel ?? "standard",
          selectedJobTypes: current.selectedJobTypes ?? [],
          laundryEnabled: (current.laundryDetail as any)?.hasLaundry === true,
        }),
      });
      const result = await res.json();
      if (result.estimatedHours) {
        setEstimation(result);
        onChange({
          ...dataRef.current,
          estimatedHours: result.estimatedHours,
          estimatedCleanerCount: result.suggestedCleanerCount,
          estimatedPrice: result.estimatedPrice,
        });
      }
    } catch {
      /* silent — estimate is best-effort */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <EField label="Requested cleaner count">
          <EInput
            type="number"
            min={1}
            max={20}
            className="tabular-nums"
            value={Number(data.requestedCleanerCount ?? 1)}
            onChange={(e) => onChange({ ...data, requestedCleanerCount: parseInt(e.target.value) || 1 })}
          />
        </EField>
        {estimation ? (
          <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
            <p className="text-[0.8125rem] font-[600]">Auto-estimated</p>
            <div className="mt-2 space-y-1 text-[0.8125rem]">
              <div className="flex justify-between">
                <span className="text-[hsl(var(--e-muted-foreground))]">Hours</span>
                <span className="font-[600] tabular-nums">{estimation.estimatedHours}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[hsl(var(--e-muted-foreground))]">Cleaners</span>
                <span className="font-[600] tabular-nums">{estimation.suggestedCleanerCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[hsl(var(--e-muted-foreground))]">Est. price</span>
                <span className="font-[600] tabular-nums">${estimation.estimatedPrice.toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <EBadge tone={estimation.confidence === "high" ? "success" : "warning"} soft>
                {estimation.confidence} confidence
              </EBadge>
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            </div>
          </div>
        ) : null}
      </div>

      {estimation?.priceBreakdown && estimation.priceBreakdown.length > 0 ? (
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
          <p className="mb-2 text-[0.8125rem] font-[600]">Price breakdown</p>
          {estimation.priceBreakdown.map((item, i) => (
            <div key={i} className="flex justify-between py-1 text-[0.8125rem]">
              <span className="text-[hsl(var(--e-muted-foreground))]">{item.label}</span>
              <span className="tabular-nums">${item.amount.toFixed(2)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {estimation?.warnings && estimation.warnings.length > 0 ? (
        <div className="rounded-[var(--e-radius-lg)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3 text-[0.8125rem]">
          {estimation.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── Step 11: Schedule / iCal ───────────────────────────────────────────── */
export function StepIcal({ data, onChange }: StepProps) {
  const [validating, setValidating] = React.useState(false);
  const [validationResult, setValidationResult] = React.useState<{
    valid: boolean;
    eventCount?: number;
    provider?: string;
    error?: string;
  } | null>(null);

  async function validateUrl() {
    const url = String(data.icalUrl ?? "");
    if (!url) return;

    setValidating(true);
    try {
      const res = await fetch("/api/admin/onboarding/ical/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icalUrl: url }),
      });
      const result = await res.json();
      setValidationResult(result);
      if (result.valid) {
        onChange({ ...data, icalProvider: result.provider });
        toast({ title: "iCal feed validated", description: `${result.eventCount} events found.` });
      } else {
        toast({ title: "iCal validation failed", description: result.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className={MUTED}>
        Optionally provide an iCal URL to auto-sync reservations. This step can be skipped and configured later.
      </p>

      <EField label="iCal feed URL">
        <div className="flex gap-2">
          <EInput
            value={String(data.icalUrl ?? "")}
            onChange={(e) => {
              onChange({ ...data, icalUrl: e.target.value || null });
              setValidationResult(null);
            }}
            placeholder="https://example.com/calendar.ics"
          />
          <EButton variant="outline" onClick={() => void validateUrl()} disabled={!data.icalUrl || validating}>
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validate"}
          </EButton>
        </div>
      </EField>

      {validationResult ? (
        <div
          className={`flex items-center gap-2 rounded-[var(--e-radius-lg)] border-l-[3px] p-3 text-[0.8125rem] ${
            validationResult.valid
              ? "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))]"
              : "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))]"
          }`}
        >
          {validationResult.valid ? (
            <CheckCircle2 className="h-4 w-4 text-[hsl(var(--e-success))]" />
          ) : (
            <XCircle className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          )}
          <span>
            {validationResult.valid
              ? `Valid feed — ${validationResult.eventCount} events found.`
              : validationResult.error}
          </span>
          {validationResult.provider ? (
            <EBadge tone="neutral" soft>
              {validationResult.provider.replace("ICAL_", "").replace(/_/g, " ")}
            </EBadge>
          ) : null}
        </div>
      ) : null}

      <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
        Tip: You can skip this step and add the iCal link later in the property settings.
      </p>
    </div>
  );
}
