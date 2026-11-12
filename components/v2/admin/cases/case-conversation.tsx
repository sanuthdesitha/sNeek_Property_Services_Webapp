"use client";

/**
 * The conversation column: title, who opened it, the two state actions as
 * drawn (Waiting on client, Resolve), a "more" menu with every other existing
 * action, the thread and the composer.
 */
import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPill } from "@/components/v2/ui/pill";
import { CASE_STATUS_LABELS } from "@/lib/cases/status";
import { CaseThread, formatCaseTime } from "./case-thread";
import { CaseComposer, type ComposerDraft } from "./case-composer";
import { isClosedStatus, personLabel, type CaseDetail, type CaseStatus, type CaseViewer } from "./case-types";

type StatusAction = { label: string; next: CaseStatus; show: (status: CaseStatus) => boolean };

/** The old screen's quick actions, unchanged. Two are drawn as buttons; the rest live in the menu. */
export const CASE_STATUS_ACTIONS: StatusAction[] = [
  { label: "Triage", next: "TRIAGE", show: (s) => s === "OPEN" },
  { label: "Investigate", next: "INVESTIGATING", show: (s) => s === "OPEN" || s === "TRIAGE" || s === "WAITING_CLIENT" || s === "WAITING_INTERNAL" },
  { label: "Waiting on client", next: "WAITING_CLIENT", show: (s) => s !== "WAITING_CLIENT" && !isClosedStatus(s) },
  { label: "Waiting on team", next: "WAITING_INTERNAL", show: (s) => s !== "WAITING_INTERNAL" && !isClosedStatus(s) },
  { label: "Resolve", next: "RESOLVED", show: (s) => !isClosedStatus(s) },
  { label: "Close", next: "CLOSED", show: (s) => s === "RESOLVED" },
  { label: "Reopen", next: "OPEN", show: (s) => isClosedStatus(s) },
];

const DRAWN = new Set<CaseStatus>(["WAITING_CLIENT", "RESOLVED"]);

function openedByLine(detail: CaseDetail): string {
  const first = detail.comments[0];
  const by = first?.author ? personLabel(first.author) : detail.source ? detail.source.toLowerCase().replace(/_/g, " ") : null;
  return `Opened ${formatCaseTime(detail.createdAt)}${by ? ` by ${by}` : ""}`;
}

type Props = {
  detail: CaseDetail;
  viewer: CaseViewer | null;
  saving: boolean;
  draft: ComposerDraft;
  onDraft: (draft: ComposerDraft) => void;
  sending: boolean;
  uploading: boolean;
  onSend: () => void;
  onAttach: (file: File) => void;
  onStatus: (next: CaseStatus, label: string) => void;
  onAssignToMe: () => void;
  onEditDetails: () => void;
  onDelete: () => void;
  onBack: () => void;
};

export function CaseConversation(props: Props) {
  const { detail, viewer, saving } = props;
  const actions = CASE_STATUS_ACTIONS.filter((action) => action.show(detail.status));
  const drawn = actions.filter((action) => DRAWN.has(action.next));
  const menuItems: ERowMenuItem[] = [
    ...actions.filter((action) => !DRAWN.has(action.next)).map((action) => ({
      key: action.next,
      label: action.label,
      onSelect: () => props.onStatus(action.next, action.label),
    })),
    ...(viewer?.id && detail.assignedTo?.id !== viewer.id ? [{ key: "assign-me", label: "Assign to me", onSelect: props.onAssignToMe, separated: true }] : []),
    { key: "edit", label: "Edit details", onSelect: props.onEditDetails },
    ...(detail.jobId ? [{ key: "job", label: "Open job", href: `/v2/admin/jobs/${detail.jobId}` }] : []),
    ...(detail.reportId ? [{ key: "report", label: "Open report", href: `/v2/admin/reports?reportId=${detail.reportId}` }] : []),
    { key: "delete", label: "Delete case…", danger: true, separated: true, onSelect: props.onDelete },
  ];

  return (
    <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] lg:rounded-none lg:border-l-0">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <div className="min-w-0">
          <EButton variant="ghost" size="sm" className="mb-1 lg:hidden" onClick={props.onBack}>
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> Cases
          </EButton>
          <h2 className="e-serif break-words text-[1.25rem] leading-tight">{detail.title}</h2>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {openedByLine(detail)} · <EPill tone={isClosedStatus(detail.status) ? "ok" : "neutral"}>{CASE_STATUS_LABELS[detail.status]}</EPill>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {drawn.map((action) => (
            <EButton key={action.next} size="sm" variant={action.next === "RESOLVED" ? "primary" : "outline"} disabled={saving} onClick={() => props.onStatus(action.next, action.label)}>
              {action.label}
            </EButton>
          ))}
          <ERowMenu label={`More actions for ${detail.title}`} items={menuItems} disabled={saving} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--e-background))] px-4 py-3">
        <CaseThread detail={detail} viewerId={viewer?.id ?? null} />
      </div>
      <CaseComposer
        detail={detail}
        draft={props.draft}
        onDraft={props.onDraft}
        sending={props.sending}
        uploading={props.uploading}
        onSend={props.onSend}
        onAttach={props.onAttach}
      />
    </section>
  );
}
