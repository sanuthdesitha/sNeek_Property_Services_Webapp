"use client";

/**
 * "New case": the old create form (title, type, priority, description, client
 * can see / reply) plus optional links to a job, property or client. Picking a
 * job fills its property and client in (shown, not hidden); the server checks
 * that the links exist and agree. A failed create keeps the draft.
 * Everyday dialog pattern (board "Everyday dialogs and sheets", 2026-11): type
 * and priority as chips, client visibility as ONE three-way choice near the
 * top (Hidden / Client can see / Can see and reply), mapped onto the same
 * clientVisible / clientCanReply fields the create route always took.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EChoiceChips, ENote } from "@/components/v2/ui/form-dialog-parts";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
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

type Visibility = "hidden" | "see" | "reply";

const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: "hidden", label: "Hidden from client" },
  { value: "see", label: "Client can see" },
  { value: "reply", label: "Can see and reply" },
];

function visibilityOf(draft: Pick<Draft, "clientVisible" | "clientCanReply">): Visibility {
  if (!draft.clientVisible) return "hidden";
  return draft.clientCanReply ? "reply" : "see";
}

/** Hidden keeps "can reply" at its default, as the old switches sent it. */
function visibilityFields(value: Visibility): Pick<Draft, "clientVisible" | "clientCanReply"> {
  if (value === "hidden") return { clientVisible: false, clientCanReply: EMPTY.clientCanReply };
  return { clientVisible: true, clientCanReply: value === "reply" };
}

function severityLabel(value: Severity): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function CaseNewDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (created: CaseDetail) => void }) {
  const [draft, setDraft] = React.useState<Draft>(EMPTY);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  async function create() {
    if (saving) return;
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
    <EActionDialog
      open={open}
      layout="form"
      eyebrow="Cases"
      title="New case"
      phoneTitle="New case"
      busy={saving}
      onClose={onClose}
      footer={(
        <>
          <EButton variant="outline" size="sm" className="max-sm:hidden" onClick={onClose} disabled={saving}>Cancel</EButton>
          <EButton size="sm" onClick={() => void create()} disabled={saving}>{saving ? "Opening…" : "Open case"}</EButton>
        </>
      )}
    >
      <fieldset disabled={saving} className="min-w-0 space-y-3">
        <EChoiceChips
          label="Type"
          name="case-new-type"
          value={draft.caseType}
          onChange={(value) => set({ caseType: value })}
          options={CASE_TYPES.map((type) => ({ value: type, label: CASE_TYPE_LABELS[type] }))}
        />
        <EChoiceChips
          label="Priority"
          name="case-new-priority"
          value={draft.severity}
          onChange={(value) => set({ severity: value })}
          options={SEVERITIES.map((value) => ({ value, label: severityLabel(value) }))}
        />
        <EField label="Title">
          <EInput value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder="Short summary" className="max-sm:h-11 max-sm:text-[1rem]" />
        </EField>
        <EField label="What happened">
          <ETextarea rows={3} value={draft.description} onChange={(event) => set({ description: event.target.value })} placeholder="e.g. Noticed at QA, after the last clean." className="max-sm:text-[1rem]" />
        </EField>
        <EChoiceChips
          label="Client"
          name="case-new-visibility"
          value={visibilityOf(draft)}
          onChange={(value) => set(visibilityFields(value))}
          options={VISIBILITY_OPTIONS}
          hint={draft.clientVisible && !draft.clientId ? "No client is linked yet, so no client can see this case until one is." : undefined}
        />
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
        {error ? <ENote tone="problem" role="alert">Not opened: {error}</ENote> : null}
      </fieldset>
    </EActionDialog>
  );
}
