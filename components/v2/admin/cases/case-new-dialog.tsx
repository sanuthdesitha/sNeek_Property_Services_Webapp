"use client";

/**
 * "New case": the old create form (title, type, priority, description, client
 * can see / reply) plus optional links to a job, property or client. Picking a
 * job fills its property and client in (shown, not hidden); the server checks
 * that the links exist and agree. A failed create keeps the draft.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { CASE_TYPES } from "@/lib/cases/queues";
import { createCaseRequest } from "./case-api";
import { JobPicker, PropertyClientPickers, type PickedJob } from "./case-link-pickers";
import { CASE_TYPE_LABELS, SEVERITIES, errorMessage, type CaseDetail, type CaseTypeKey, type Severity } from "./case-types";

type Draft = {
  title: string;
  description: string;
  caseType: CaseTypeKey;
  severity: Severity;
  clientVisible: boolean;
  clientCanReply: boolean;
  job: PickedJob | null;
  propertyId: string;
  clientId: string;
};

const EMPTY: Draft = {
  title: "",
  description: "",
  caseType: "OPS",
  severity: "MEDIUM",
  clientVisible: false,
  clientCanReply: true,
  job: null,
  propertyId: "",
  clientId: "",
};

export function CaseNewDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (created: CaseDetail) => void }) {
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function create() {
    if (!draft.title.trim()) {
      setError("A case title is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await createCaseRequest({
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        caseType: draft.caseType,
        severity: draft.severity,
        clientVisible: draft.clientVisible,
        clientCanReply: draft.clientCanReply,
        jobId: draft.job?.id ?? null,
        propertyId: draft.propertyId || null,
        clientId: draft.clientId || null,
      });
      setDraft(EMPTY);
      onCreated(created);
    } catch (cause) {
      setError(errorMessage(cause, "Could not create the case."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open={open} onClose={onClose} title="New case" eyebrow="Cases">
      <fieldset disabled={saving} className="space-y-4">
        <EField label="Case title">
          <EInput value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder="Short summary" />
        </EField>
        <div className="grid gap-4 sm:grid-cols-2">
          <EField label="Case type">
            <ESelect value={draft.caseType} onChange={(event) => set({ caseType: event.target.value as CaseTypeKey })}>
              {CASE_TYPES.map((type) => <option key={type} value={type}>{CASE_TYPE_LABELS[type]}</option>)}
            </ESelect>
          </EField>
          <EField label="Priority">
            <ESelect value={draft.severity} onChange={(event) => set({ severity: event.target.value as Severity })}>
              {SEVERITIES.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}
            </ESelect>
          </EField>
        </div>
        <EField label="Description">
          <ETextarea rows={4} value={draft.description} onChange={(event) => set({ description: event.target.value })} placeholder="What happened?" />
        </EField>
        <JobPicker
          value={draft.job}
          onChange={(job) => set({ job, propertyId: job?.propertyId ?? "", clientId: job?.clientId ?? draft.clientId })}
        />
        <PropertyClientPickers
          propertyId={draft.propertyId}
          clientId={draft.clientId}
          lockedByJob={Boolean(draft.job)}
          onProperty={(option) => set({ propertyId: option?.id ?? "", clientId: option?.clientId ?? draft.clientId })}
          onClient={(clientId) => set({ clientId, propertyId: "" })}
        />
        <div className="flex flex-wrap gap-4">
          <ESwitch checked={draft.clientVisible} onCheckedChange={(value) => set({ clientVisible: value })} label="Client can see this case" />
          <ESwitch checked={draft.clientCanReply} onCheckedChange={(value) => set({ clientCanReply: value })} label="Client can reply" />
        </div>
        {draft.clientVisible && !draft.clientId ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">No client is linked, so no client can see this case yet.</p>
        ) : null}
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <EButton variant="outline" size="sm" onClick={onClose}>Cancel</EButton>
          <EButton size="sm" onClick={() => void create()}>{saving ? "Creating…" : "Create case"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
