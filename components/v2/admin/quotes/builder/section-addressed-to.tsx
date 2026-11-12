"use client";

/**
 * 1 · Addressed to: existing client, existing lead or new lead; the client's
 * existing property (fills the service address); the send recipient; the
 * service address. A saved quote keeps its lead (the quote PATCH has no lead
 * field), so on a saved quote the lead is shown, not offered for change.
 */
import * as React from "react";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { EAddressInput } from "@/components/v2/admin/onboarding/address-input";
import { SectionCard, ToggleChip } from "./section-card";
import type { ClientOption, LeadOption } from "./model";
import type { QuoteBuilderState } from "./use-quote-builder";

type PropertyOption = { id: string; name: string; address: string | null; suburb: string | null };
type PropertyState = { status: "idle" | "loading" | "ready" | "failed"; rows: PropertyOption[] };

function useClientProperties(clientId: string): PropertyState {
  const [state, setState] = React.useState<PropertyState>({ status: "idle", rows: [] });
  React.useEffect(() => {
    if (!clientId) {
      setState({ status: "idle", rows: [] });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", rows: [] });
    fetch(`/api/admin/properties?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok) return setState({ status: "failed", rows: [] });
        const list = Array.isArray(body) ? body : Array.isArray((body as { properties?: unknown })?.properties) ? (body as { properties: unknown[] }).properties : [];
        const rows = (list as Array<Record<string, unknown>>).map((p) => ({
          id: String(p.id),
          name: String(p.name ?? p.address ?? "Property"),
          address: typeof p.address === "string" ? p.address : null,
          suburb: typeof p.suburb === "string" ? p.suburb : null,
        }));
        setState({ status: "ready", rows });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed", rows: [] });
      });
    return () => controller.abort();
  }, [clientId]);
  return state;
}

export function SectionAddressedTo({ builder, clients, leads, leadName }: { builder: QuoteBuilderState; clients: ClientOption[]; leads: LeadOption[]; leadName: string | null }) {
  const b = builder;
  const properties = useClientProperties(b.recipientMode === "client" ? b.clientId : "");
  const matchedProperty = properties.rows.find((p) => p.address && p.address === b.serviceAddress)?.id ?? "";

  function chooseProperty(id: string) {
    const property = properties.rows.find((p) => p.id === id);
    if (!property) return;
    if (property.address) b.setServiceAddress(property.address);
    if (property.suburb) b.setServiceSuburb(property.suburb);
  }

  const leadLocked = b.isEdit;
  const propertyPlaceholder =
    properties.status === "loading" ? "Loading properties…" : properties.status === "failed" ? "Could not load properties" : properties.rows.length === 0 ? (b.clientId ? "No properties for this client" : "Choose a client first") : "Use an existing property…";

  return (
    <SectionCard eyebrow="1 · Addressed to">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Who the quote is for">
        <ToggleChip pressed={b.recipientMode === "client"} onClick={() => b.setRecipientMode("client")}>Existing client</ToggleChip>
        <ToggleChip pressed={b.recipientMode === "lead"} onClick={() => b.setRecipientMode("lead")} disabled={leadLocked && !b.leadId} title={leadLocked && !b.leadId ? "A saved quote can't be moved to a lead" : undefined}>
          Existing lead
        </ToggleChip>
        <ToggleChip pressed={b.recipientMode === "new"} onClick={() => b.setRecipientMode("new")} disabled={leadLocked} title={leadLocked ? "A new lead can only be added when the quote is created" : undefined}>
          New lead
        </ToggleChip>
      </div>

      {b.recipientMode === "new" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <EField label="Name"><EInput value={b.newLead.name} onChange={(e) => b.setNewLead({ ...b.newLead, name: e.target.value })} /></EField>
          <EField label="Email"><EInput type="email" value={b.newLead.email} onChange={(e) => { b.setNewLead({ ...b.newLead, email: e.target.value }); b.setRecipientEmail(e.target.value); }} /></EField>
          <EField label="Phone"><EInput value={b.newLead.phone} onChange={(e) => b.setNewLead({ ...b.newLead, phone: e.target.value })} /></EField>
          <EField label="Suburb"><EInput value={b.newLead.suburb} onChange={(e) => b.setNewLead({ ...b.newLead, suburb: e.target.value })} /></EField>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {b.recipientMode === "client" ? (
          <EField label="Client">
            <ESelect value={b.clientId} onChange={(e) => b.applyClient(e.target.value)}>
              <option value="">{b.isEdit ? `Unassigned${leadName ? ` (lead: ${leadName})` : ""}` : "Select a client…"}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ""}</option>
              ))}
            </ESelect>
          </EField>
        ) : b.recipientMode === "lead" ? (
          leadLocked ? (
            <EField label="Lead" hint="A saved quote keeps its lead. Choose Existing client to assign it to a client.">
              <EInput value={leadName ?? "Lead"} readOnly />
            </EField>
          ) : (
            <EField label="Lead">
              <ESelect value={b.leadId} onChange={(e) => b.applyLead(e.target.value)}>
                <option value="">Select a lead…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>{l.name} — {l.email}</option>
                ))}
              </ESelect>
            </EField>
          )
        ) : null}
        <EField label="Existing property" hint="Fills the service address below.">
          <ESelect value={matchedProperty} onChange={(e) => chooseProperty(e.target.value)} disabled={b.recipientMode !== "client" || properties.rows.length === 0}>
            <option value="">{b.recipientMode === "client" ? propertyPlaceholder : "Only for an existing client"}</option>
            {properties.rows.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.suburb ? ` — ${p.suburb}` : ""}</option>
            ))}
          </ESelect>
        </EField>
        <EField label="Recipient" hint="Who the quote email goes to. Empty: the client's delivery contacts.">
          <EInput type="email" value={b.recipientEmail} onChange={(e) => b.setRecipientEmail(e.target.value)} placeholder="name@example.com" />
        </EField>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
        <EField label="Service address">
          <EAddressInput
            value={b.serviceAddress}
            placeholder="Start typing an address…"
            onChange={(text) => b.setServiceAddress(text)}
            onSelect={(r) => {
              b.setServiceAddress(r.formattedAddress);
              if (r.suburb) b.setServiceSuburb(r.suburb);
            }}
          />
        </EField>
        <EField label="Suburb">
          <EInput value={b.serviceSuburb} placeholder="Suburb" onChange={(e) => b.setServiceSuburb(e.target.value)} />
        </EField>
      </div>
    </SectionCard>
  );
}
