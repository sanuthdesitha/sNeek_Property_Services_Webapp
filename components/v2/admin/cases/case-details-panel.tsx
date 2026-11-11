"use client";

/**
 * Details column: every field the old case form edited (owner, priority, type,
 * status, client can see / reply, title, description, resolution note), then
 * "Linked, filled in automatically" (read-only, derived on the server from the
 * linked job) and "Next steps" (links to existing destinations only).
 *
 * The form is a draft: nothing saves until "Save changes"; a status change goes
 * through the required status-note dialog. The fieldset is frozen while saving.
 */
import * as React from "react";
import Link from "next/link";
import { Wand2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ESwitch, ETextarea } from "@/components/v2/admin/estate-kit";
import { CASE_STATUSES, CASE_STATUS_LABELS } from "@/lib/cases/status";
import { CASE_TYPES } from "@/lib/cases/queues";
import type { CaseLinkedContext } from "@/lib/cases/linked-context";
import type { CasePatch } from "./case-api";
import { formatCaseTime } from "./case-thread";
import type { CaseDetailStatus } from "./use-case-detail";
import {
  CASE_TYPE_LABELS,
  RESOLUTION_TEMPLATES,
  SEVERITIES,
  personLabel,
  type AssigneeOption,
  type CaseDetail,
  type CaseStatus,
  type CaseTypeKey,
  type CaseViewer,
  type Severity,
} from "./case-types";

type FormDraft = {
  title: string;
  assignedToUserId: string;
  severity: Severity;
  caseType: CaseTypeKey;
  status: CaseStatus;
  clientVisible: boolean;
  clientCanReply: boolean;
  description: string;
  resolutionNote: string;
};

function draftFrom(detail: CaseDetail): FormDraft {
  return {
    title: detail.title,
    assignedToUserId: detail.assignedTo?.id ?? "",
    severity: detail.severity,
    caseType: detail.caseType,
    status: detail.status,
    clientVisible: detail.clientVisible,
    clientCanReply: detail.clientCanReply,
    description: detail.description ?? "",
    resolutionNote: detail.resolutionNote ?? "",
  };
}

/** Only the fields that changed, so a save never rewrites what nobody touched. */
export function changedFields(detail: CaseDetail, draft: FormDraft): CasePatch {
  const base = draftFrom(detail);
  const patch: CasePatch = {};
  if (draft.title.trim() && draft.title !== base.title) patch.title = draft.title.trim();
  if (draft.assignedToUserId !== base.assignedToUserId) patch.assignedToUserId = draft.assignedToUserId || null;
  if (draft.severity !== base.severity) patch.severity = draft.severity;
  if (draft.caseType !== base.caseType) patch.caseType = draft.caseType;
  if (draft.status !== base.status) patch.status = draft.status;
  if (draft.clientVisible !== base.clientVisible) patch.clientVisible = draft.clientVisible;
  if (draft.clientCanReply !== base.clientCanReply) patch.clientCanReply = draft.clientCanReply;
  if (draft.description !== base.description) patch.description = draft.description || null;
  if (draft.resolutionNote !== base.resolutionNote) patch.resolutionNote = draft.resolutionNote || null;
  return patch;
}

type Props = {
  detail: CaseDetail;
  linked: CaseLinkedContext | null;
  linkedStatus: CaseDetailStatus;
  assignees: AssigneeOption[];
  viewer: CaseViewer | null;
  saving: boolean;
  onSave: (patch: CasePatch) => void;
  titleRef?: React.Ref<HTMLInputElement>;
};

function LinkedFacts({ linked, status }: { linked: CaseLinkedContext | null; status: CaseDetailStatus }) {
  if (status === "loading") return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading linked details…</p>;
  if (status === "error" || !linked) return <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Linked details could not be loaded.</p>;
  const { job, evidence } = linked;
  const rows: Array<[string, React.ReactNode]> = [
    ["Job", job ? <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${job.id}`}>{job.jobNumber ?? "Job"} · {formatCaseTime(job.scheduledDate).split(",")[0]}</Link> : "Not linked"],
    ["Property", linked.property ? `${linked.property.name}${linked.property.suburb ? `, ${linked.property.suburb}` : ""}` : "Not linked"],
    ["Client", linked.client?.name ?? "Not linked"],
    ["Cleaner", job ? (linked.cleaners.length ? linked.cleaners.map((c) => c.name).join(", ") : "None assigned") : "—"],
    ["Guest out", job ? (linked.departingGuest?.name || linked.departingGuest?.phoneLabel ? <>{linked.departingGuest?.name ?? "Name not given"}{linked.departingGuest?.phoneLabel ? <> · {linked.departingGuest.phoneHref ? <a className="text-[hsl(var(--e-primary))] hover:underline" href={`tel:${linked.departingGuest.phoneHref}`}>{linked.departingGuest.phoneLabel}</a> : linked.departingGuest.phoneLabel}</> : null}</> : "Not recorded") : "—"],
    ["Report", linked.report ? <Link className="text-[hsl(var(--e-primary))] hover:underline" href={linked.report.href}>Service report</Link> : "None"],
    ["Evidence", `${evidence.jobPhotos === null ? "No job linked" : `${evidence.jobPhotos} job photo${evidence.jobPhotos === 1 ? "" : "s"}`}, ${evidence.clientAttachments} from client${evidence.officeAttachments ? `, ${evidence.officeAttachments} from office` : ""}`],
  ];
  return (
    <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function CaseDetailsPanel({ detail, linked, linkedStatus, assignees, viewer, saving, onSave, titleRef }: Props) {
  const [draft, setDraft] = React.useState<FormDraft>(() => draftFrom(detail));
  const patch = changedFields(detail, draft);
  const dirty = Object.keys(patch).length > 0;
  const set = (next: Partial<FormDraft>) => setDraft((current) => ({ ...current, ...next }));

  return (
    <div className="flex flex-col gap-3">
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-3">
        <EField label="Owner">
          <ESelect value={draft.assignedToUserId} onChange={(event) => set({ assignedToUserId: event.target.value })}>
            <option value="">Unowned</option>
            {assignees.map((person) => <option key={person.id} value={person.id}>{person.id === viewer?.id ? `You (${personLabel(person)})` : personLabel(person)}</option>)}
          </ESelect>
        </EField>
        {viewer?.id && draft.assignedToUserId !== viewer.id ? (
          <EButton size="sm" variant="outline" className="self-start" onClick={() => onSave({ assignedToUserId: viewer.id })}>Assign to me</EButton>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <EField label="Priority">
            <ESelect value={draft.severity} onChange={(event) => set({ severity: event.target.value as Severity })}>
              {SEVERITIES.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}
            </ESelect>
          </EField>
          <EField label="Type">
            <ESelect value={draft.caseType} onChange={(event) => set({ caseType: event.target.value as CaseTypeKey })}>
              {CASE_TYPES.map((value) => <option key={value} value={value}>{CASE_TYPE_LABELS[value]}</option>)}
            </ESelect>
          </EField>
        </div>
        <EField label="Status" hint="Changing the status asks for a note.">
          <ESelect value={draft.status} onChange={(event) => set({ status: event.target.value as CaseStatus })}>
            {CASE_STATUSES.map((value) => <option key={value} value={value}>{CASE_STATUS_LABELS[value]}</option>)}
          </ESelect>
        </EField>
        <div className="flex flex-col gap-2 text-[0.8125rem]">
          <ESwitch checked={draft.clientVisible} onCheckedChange={(value) => set({ clientVisible: value })} label="Client can see this case" />
          <ESwitch checked={draft.clientCanReply} onCheckedChange={(value) => set({ clientCanReply: value })} label="Client can reply" />
        </div>
        <EField label="Title">
          <EInput ref={titleRef} value={draft.title} onChange={(event) => set({ title: event.target.value })} />
        </EField>
        <EField label="Description">
          <ETextarea rows={3} value={draft.description} onChange={(event) => set({ description: event.target.value })} />
        </EField>
        <EField label="Resolution / admin note">
          <ETextarea rows={3} value={draft.resolutionNote} onChange={(event) => set({ resolutionNote: event.target.value })} />
        </EField>
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" variant="outline" onClick={() => set({ resolutionNote: RESOLUTION_TEMPLATES[draft.caseType] })}>
            <Wand2 aria-hidden className="h-3.5 w-3.5" /> Use template
          </EButton>
          <EButton size="sm" disabled={!dirty} onClick={() => onSave(patch)}>{saving ? "Saving…" : "Save changes"}</EButton>
          {dirty ? <EButton size="sm" variant="ghost" onClick={() => setDraft(draftFrom(detail))}>Discard</EButton> : null}
        </div>
      </fieldset>
      <div className="h-px bg-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">Linked, filled in automatically</p>
      <LinkedFacts linked={linked} status={linkedStatus} />
      <div className="h-px bg-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">Next steps</p>
      <div className="flex flex-col items-start gap-1.5">
        <EButton asChild size="sm" variant="outline"><Link href={linked?.nextSteps.repairQuoteHref ?? "/v2/admin/quotes/new"}>Create repair quote</Link></EButton>
        <EButton asChild size="sm" variant="outline">
          <Link href={linked?.nextSteps.clientDraftInvoicesHref ?? linked?.nextSteps.newInvoiceHref ?? "/v2/admin/finance?tab=invoices&new=jobs"}>Add charge to invoice</Link>
        </EButton>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {linked?.nextSteps.clientDraftInvoicesHref ? "Opens this client’s draft invoices; nothing is charged from here." : "Opens a new invoice; nothing is charged from here."}
        </p>
      </div>
    </div>
  );
}
