"use client";

/** Steps 1–3: basics and address, client and owner, rooms and beds. */
import * as React from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField } from "@/components/v2/admin/estate-kit";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import { ON_SITE_RADIUS_M } from "@/lib/gps/distance";
import type { ApplianceValue, BasicsValues, ClientValues, RoomsValues } from "@/lib/onboarding/workspace/values";
import type { OnboardingRoom, OnboardingRoomKind } from "@/lib/onboarding/workspace/types";
import type { OnboardingWorkspaceView } from "@/lib/onboarding/workspace/view-types";
import { useSectionDraft } from "./use-onboarding-workspace";
import { AutoTextField, ONB_INPUT_CLASS, ONB_MUTED, PillToggle, newLocalId, numberText, parseNumberInput } from "./onboarding-kit";

export type StepProps<T> = {
  view: OnboardingWorkspaceView;
  values: T;
  send: (patch: Partial<T> | Record<string, unknown>) => void;
};

const PROPERTY_TYPES = [
  { value: "", label: "Not set" },
  { value: "HOUSE", label: "House" },
  { value: "APARTMENT", label: "Apartment" },
  { value: "TOWNHOUSE", label: "Townhouse" },
  { value: "UNIT", label: "Unit" },
  { value: "DUPLEX", label: "Duplex" },
];

export function BasicsStep({ values, send }: StepProps<BasicsValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<BasicsValues>(values, send);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AutoTextField label="Property name *" hint="What the team calls it. Shown on every job." value={draft.propertyName} onChange={(v) => set("propertyName", v)} onCommit={() => commit("propertyName")} />
      <EField label="Address *" hint="Picked from the address search, so suburb, state, postcode and the pin are filled.">
        <EAddressInput
          value={draft.propertyAddress}
          onChange={(text) => set("propertyAddress", text)}
          onSelect={(result) => {
            const street = [result.unit ? `${result.unit}/` : "", result.streetNumber ?? "", result.route ? ` ${result.route}` : ""].join("").trim() || result.formattedAddress;
            const patch: Partial<BasicsValues> = {
              propertyAddress: street,
              propertySuburb: result.suburb ?? draft.propertySuburb,
              propertyState: result.state ?? draft.propertyState,
              propertyPostcode: result.postcode ?? draft.propertyPostcode,
              propertyLatitude: result.lat,
              propertyLongitude: result.lng,
              propertyPlaceId: result.placeId,
            };
            for (const [key, value] of Object.entries(patch)) set(key as keyof BasicsValues, value as never);
            send(patch);
          }}
        />
      </EField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:col-span-2">
        <AutoTextField label="Suburb *" value={draft.propertySuburb} onChange={(v) => set("propertySuburb", v)} onCommit={() => commit("propertySuburb")} />
        <AutoTextField label="State" value={draft.propertyState} onChange={(v) => set("propertyState", v)} onCommit={() => commit("propertyState")} />
        <AutoTextField label="Postcode" inputMode="numeric" value={draft.propertyPostcode} onChange={(v) => set("propertyPostcode", v)} onCommit={() => commit("propertyPostcode")} />
      </div>
      <p className={`${ONB_MUTED} md:col-span-2`}>
        {draft.propertyLatitude !== null && draft.propertyLongitude !== null
          ? "Pin set from the address search."
          : "No pin yet. Pick the address from the search; otherwise the address is looked up on activation."}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 md:col-span-2">
        <EField label="Type">
          <select className={ONB_INPUT_CLASS} value={draft.propertyType} onChange={(event) => setAndCommit("propertyType", event.target.value)}>
            {PROPERTY_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </EField>
        <AutoTextField label="Floors" inputMode="numeric" value={String(draft.floorCount)} onChange={(v) => set("floorCount", Math.max(1, Math.min(20, Math.round(parseNumberInput(v) ?? 1))))} onCommit={() => commit("floorCount")} />
        <AutoTextField label="Size, m²" inputMode="decimal" placeholder="Optional" value={numberText(draft.sizeSqm)} onChange={(v) => set("sizeSqm", parseNumberInput(v))} onCommit={() => commit("sizeSqm")} />
      </div>
      <AutoTextField
        className="md:col-span-2"
        label="On-site radius for clock-in"
        inputMode="numeric"
        placeholder={String(ON_SITE_RADIUS_M)}
        hint={`Metres · default ${ON_SITE_RADIUS_M} · raise for big complexes or basement parking (the property already has this setting). Empty keeps the default.`}
        value={numberText(draft.clockInRadiusM)}
        onChange={(v) => set("clockInRadiusM", parseNumberInput(v))}
        onCommit={() => {
          const value = draft.clockInRadiusM;
          if (value !== null && (value < 50 || value > 2000)) return;
          commit("clockInRadiusM");
        }}
      />
      {draft.clockInRadiusM !== null && (draft.clockInRadiusM < 50 || draft.clockInRadiusM > 2000) ? (
        <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))] md:col-span-2">Use a radius between 50 and 2000 metres. Not saved yet.</p>
      ) : null}
      <AutoTextField className="md:col-span-2" label="Property notes" multiline value={draft.propertyNotes} onChange={(v) => set("propertyNotes", v)} onCommit={() => commit("propertyNotes")} />
    </div>
  );
}

type ClientOption = { id: string; name: string; email: string | null; phone: string | null; _count?: { properties?: number } };

export function ClientStep({ values, send }: StepProps<ClientValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<ClientValues>(values, send);
  const [clients, setClients] = React.useState<ClientOption[] | null>(null);
  const [clientsError, setClientsError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/clients", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok || !Array.isArray(body)) throw new Error("load");
        setClients(body as ClientOption[]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setClientsError("The client list could not be loaded. Retry by opening this step again.");
      });
    return () => controller.abort();
  }, []);

  const selected = clients?.find((client) => client.id === draft.existingClientId) ?? null;
  const matches = (clients ?? []).filter((client) => !query.trim() || client.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8);
  const setClientField = (key: keyof ClientValues["clientData"], value: string) => set("clientData", { ...draft.clientData, [key]: value });
  const setContact = (key: keyof ClientValues["emergencyContact"], value: string) => set("emergencyContact", { ...draft.emergencyContact, [key]: value });

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Client" className="inline-flex rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-0.5">
        <PillToggle pressed={!draft.isNewClient} onClick={() => setAndCommit("isNewClient", false)}>Existing client</PillToggle>
        <PillToggle pressed={draft.isNewClient} onClick={() => setAndCommit("isNewClient", true)}>New client</PillToggle>
      </div>
      {!draft.isNewClient ? (
        <div className="space-y-2">
          {selected ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] p-3">
              <div className="min-w-0">
                <p className="font-[600]">{selected.name}</p>
                <p className={`${ONB_MUTED} break-words`}>{[selected.email, selected.phone, typeof selected._count?.properties === "number" ? `${selected._count.properties} properties` : null].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex gap-2">
                <EButton asChild variant="ghost" size="sm"><Link href={`/v2/admin/clients/${selected.id}`}>Open</Link></EButton>
                <EButton variant="outline" size="sm" onClick={() => setAndCommit("existingClientId", null)}>Change</EButton>
              </div>
            </div>
          ) : (
            <>
              <EField label="Find a client">
                <input className={ONB_INPUT_CLASS} value={query} placeholder="Type a name" onChange={(event) => setQuery(event.target.value)} />
              </EField>
              {clientsError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{clientsError}</p> : null}
              {clients === null && !clientsError ? <p role="status" className={ONB_MUTED}>Loading clients…</p> : null}
              {clients !== null && matches.length === 0 ? <p className={ONB_MUTED}>No client matches “{query}”.</p> : null}
              <ul className="divide-y divide-[hsl(var(--e-border))] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                {matches.map((client) => (
                  <li key={client.id}>
                    <button type="button" className="flex min-h-11 w-full flex-col items-start px-3 py-2 text-left hover:bg-[hsl(var(--e-muted))]" onClick={() => setAndCommit("existingClientId", client.id)}>
                      <span className="font-[550]">{client.name}</span>
                      <span className={ONB_MUTED}>{[client.email, client.phone].filter(Boolean).join(" · ") || "No contact saved"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <AutoTextField label="Client name *" value={draft.clientData.name} onChange={(v) => setClientField("name", v)} onCommit={() => commit("clientData")} />
          <AutoTextField label="Email" type="email" value={draft.clientData.email} onChange={(v) => setClientField("email", v)} onCommit={() => commit("clientData")} />
          <AutoTextField label="Phone" type="tel" value={draft.clientData.phone} onChange={(v) => setClientField("phone", v)} onCommit={() => commit("clientData")} />
          <AutoTextField label="Address" value={draft.clientData.address} onChange={(v) => setClientField("address", v)} onCommit={() => commit("clientData")} />
          <AutoTextField className="md:col-span-2" label="Notes" multiline value={draft.clientData.notes} onChange={(v) => setClientField("notes", v)} onCommit={() => commit("clientData")} />
          <p className={`${ONB_MUTED} md:col-span-2`}>The new client is created on activation, the same as Add client. A portal invite is sent from the client&apos;s page afterwards.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AutoTextField label="Owner or emergency contact" value={draft.emergencyContact.name} onChange={(v) => setContact("name", v)} onCommit={() => commit("emergencyContact")} />
        <AutoTextField label="Phone" type="tel" value={draft.emergencyContact.phone} onChange={(v) => setContact("phone", v)} onCommit={() => commit("emergencyContact")} />
        <AutoTextField label="Relationship" value={draft.emergencyContact.relation} onChange={(v) => setContact("relation", v)} onCommit={() => commit("emergencyContact")} />
      </div>
      <p className={ONB_MUTED}>The owner contact goes to the first job&apos;s internal notes, as today.</p>
    </div>
  );
}

const APPLIANCES = ["OVEN", "DISHWASHER", "MICROWAVE", "WASHER", "DRYER", "RANGEHOOD", "FRIDGE"];
const ROOM_KINDS: Array<{ value: OnboardingRoomKind; label: string }> = [
  { value: "BEDROOM", label: "Bedroom" },
  { value: "BATHROOM", label: "Bathroom" },
  { value: "LIVING", label: "Living" },
  { value: "KITCHEN", label: "Kitchen" },
  { value: "OTHER", label: "Other" },
];

function applianceLabel(type: string): string {
  return type.charAt(0) + type.slice(1).toLowerCase();
}

export function RoomsStep({ values, send }: StepProps<RoomsValues>) {
  const { draft, set, commit, setAndCommit } = useSectionDraft<RoomsValues>(values, send);
  const updateRoom = (id: string, patch: Partial<OnboardingRoom>) => set("roomList", draft.roomList.map((room) => (room.id === id ? { ...room, ...patch } : room)));
  const toggleAppliance = (type: string) => {
    const exists = draft.appliances.some((appliance) => appliance.applianceType === type);
    const next: ApplianceValue[] = exists ? draft.appliances.filter((appliance) => appliance.applianceType !== type) : [...draft.appliances, { applianceType: type, conditionNote: "", requiresClean: true }];
    setAndCommit("appliances", next);
  };
  const countField = (key: "bedrooms" | "bathrooms", label: string) => (
    <AutoTextField label={label} inputMode="numeric" value={String(draft[key])} onChange={(v) => set(key, Math.max(0, Math.min(50, Math.round(parseNumberInput(v) ?? 0))))} onCommit={() => commit(key)} />
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {countField("bedrooms", "Bedrooms")}
        {countField("bathrooms", "Bathrooms")}
        <AutoTextField label="Sofa beds" inputMode="numeric" value={numberText(draft.sofaBeds)} onChange={(v) => set("sofaBeds", parseNumberInput(v))} onCommit={() => commit("sofaBeds")} />
        <EField label="Balcony">
          <select className={ONB_INPUT_CLASS} value={draft.hasBalcony ? "yes" : "no"} onChange={(event) => setAndCommit("hasBalcony", event.target.value === "yes")}>
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </EField>
      </div>

      <section aria-label="Rooms and beds" className="space-y-2">
        <div className="hidden grid-cols-[1.2fr_0.9fr_1fr_1.3fr_auto] gap-2 px-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))] 2xl:grid">
          <span>Room</span><span>Kind</span><span>Beds</span><span>Notes</span><span className="sr-only">Remove</span>
        </div>
        {draft.roomList.length === 0 ? <p className={ONB_MUTED}>No rooms listed yet. Add each bedroom, living area or other room that has beds.</p> : null}
        {draft.roomList.map((room, index) => (
          <div key={room.id} className="grid grid-cols-1 gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 sm:grid-cols-2 2xl:grid-cols-[1.2fr_0.9fr_1fr_1.3fr_auto] 2xl:border-0 2xl:p-0">
            <input aria-label={`Room ${index + 1} name`} className={ONB_INPUT_CLASS} value={room.name} placeholder="Bedroom 1" onChange={(event) => updateRoom(room.id, { name: event.target.value })} onBlur={() => commit("roomList")} />
            <select aria-label={`Room ${index + 1} kind`} className={ONB_INPUT_CLASS} value={room.kind} onChange={(event) => { const next = draft.roomList.map((r) => (r.id === room.id ? { ...r, kind: event.target.value as OnboardingRoomKind } : r)); setAndCommit("roomList", next); }}>
              {ROOM_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </select>
            <input aria-label={`Room ${index + 1} beds`} className={ONB_INPUT_CLASS} value={room.beds} placeholder="1 King" onChange={(event) => updateRoom(room.id, { beds: event.target.value })} onBlur={() => commit("roomList")} />
            <input aria-label={`Room ${index + 1} notes`} className={ONB_INPUT_CLASS} value={room.notes} placeholder="Ensuite, travel cot…" onChange={(event) => updateRoom(room.id, { notes: event.target.value })} onBlur={() => commit("roomList")} />
            <EButton variant="ghost" size="icon" aria-label={`Remove ${room.name || `room ${index + 1}`}`} onClick={() => setAndCommit("roomList", draft.roomList.filter((r) => r.id !== room.id))}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </EButton>
          </div>
        ))}
        <EButton variant="outline" size="sm" onClick={() => setAndCommit("roomList", [...draft.roomList, { id: newLocalId("room"), name: `Bedroom ${draft.roomList.filter((r) => r.kind === "BEDROOM").length + 1}`, kind: "BEDROOM", beds: "", notes: "" }])}>
          <Plus className="h-4 w-4" aria-hidden /> Add room
        </EButton>
      </section>

      <AutoTextField
        label="Bed notes"
        hint="Kept from the earlier free-text bed configuration, if there was one. It is added to the property notes on activation."
        multiline
        value={draft.roomNote}
        onChange={(v) => set("roomNote", v)}
        onCommit={() => commit("roomNote")}
      />

      <div className="space-y-2">
        <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]" id="appliances-label">Appliances</p>
        <div role="group" aria-labelledby="appliances-label" className="flex flex-wrap gap-2">
          {APPLIANCES.map((type) => (
            <PillToggle key={type} pressed={draft.appliances.some((appliance) => appliance.applianceType === type)} onClick={() => toggleAppliance(type)}>
              {applianceLabel(type)}
            </PillToggle>
          ))}
        </div>
      </div>
      <EToneNotice tone="info">
        On the cleaner&apos;s form: {draft.bedrooms} bedroom section{draft.bedrooms === 1 ? "" : "s"}, {draft.bathrooms} bathroom section{draft.bathrooms === 1 ? "" : "s"}
        {draft.sofaBeds ? `, ${draft.sofaBeds === 1 ? "a sofa-bed task" : `${draft.sofaBeds} sofa-bed tasks`}` : ""}
        {draft.hasBalcony ? " and the balcony section" : ""}, through the existing property conditions.
      </EToneNotice>
    </div>
  );
}
