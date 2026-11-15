"use client";

/**
 * QA issue side panel (board "QualitySubpages", issue panel; board
 * "M-QualityDetail", frames 1–3). Opened from the Issues tab or an expanded
 * cleaner row. Beside the list from `lg`; a full-height sheet below it; a full
 * screen with ONE decision docked at the bottom on a phone, where the actions
 * open as bottom sheets.
 *
 * Everything the old QA issue dialog had is here: facts, description, QA
 * photos, before/after photos, the job link and (ADMIN / OPS_MANAGER with a
 * manageable quality pack) every action: record the fix, propose a deduction,
 * escalate, confirm or reject a suspected false confirmation. QA inspectors
 * and read-only packs see it without actions or the docked bar.
 *
 * Drafts: the hub owns the unsent text (`draft`), so closing the panel keeps
 * it until another issue is opened.
 */
import * as React from "react";
import Link from "next/link";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { cn } from "@/lib/utils";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";
import { caseHref } from "@/lib/quality/case-origin";
import { severityLabel } from "@/lib/quality/severity";
import {
  falseConfirmationLabel,
  formatAud,
  isFixedStatus,
  isNoAfterPhoto,
  rectificationLabel,
} from "@/lib/quality/issue-presentation";
import { falseConfirmationTone, formatIssueMoment, keyList, rectificationTone, severityTone, titleCaseKey } from "./issue-format";
import { useEvidenceUrls, type EvidenceUrls } from "./issue-evidence";
import {
  DeductionForm,
  EscalateForm,
  ISSUE_ACTION_TITLE,
  RectifyForm,
  useIssueSubmit,
  type IssueActionKey,
  type IssueDraft,
} from "./issue-action-forms";
import type { IssueActionBody } from "./issue-requests";

export type IssuePanelProps = {
  issue: QualityIssueRow;
  categoryLabel: string;
  canManage: boolean;
  initialAction?: IssueActionKey | null;
  /** settings.accountability.scoring.falseConfirmationExtraDeduction, or null when unknown. */
  falseConfirmationDeduction: number | null;
  timeZone: string;
  draft: IssueDraft;
  onDraft: (next: IssueDraft) => void;
  onClose: () => void;
  /** Called after a successful action; the caller re-reads its lists. */
  onChanged: () => void | Promise<void>;
};

/** A QA photo with whether the inspector marked it up. */
type QaPhoto = { key: string; markedUp: boolean };

function qaPhotos(raw: unknown): QaPhoto[] {
  if (!Array.isArray(raw)) return [];
  const photos: QaPhoto[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry) photos.push({ key: entry, markedUp: false });
    else if (entry && typeof entry === "object") {
      const record = entry as { key?: unknown; flatKey?: unknown; annotatedKey?: unknown };
      // The flattened composite shows the marks; never the bare overlay.
      const key = typeof record.flatKey === "string" ? record.flatKey : typeof record.key === "string" ? record.key : null;
      if (key) photos.push({ key, markedUp: typeof record.flatKey === "string" || typeof record.annotatedKey === "string" });
    }
  }
  return photos;
}

/** The panel title: the first sentence of the description (the record has no separate title). */
export function issueTitle(description: string): string {
  const text = description.trim();
  if (!text) return "QA issue";
  const sentence = text.match(/^(.{1,110}?[.!?])(\s|$)/)?.[1] ?? text;
  return sentence.length > 110 ? `${sentence.slice(0, 107).trimEnd()}…` : sentence;
}

function timeZoneName(timeZone: string): string {
  const city = timeZone.split("/").pop() ?? timeZone;
  return city.replace(/_/g, " ");
}

function payAdjustmentText(issue: QualityIssueRow): string {
  const pa = issue.payAdjustment;
  if (!pa) return "None proposed";
  const parts = [pa.status ? titleCaseKey(pa.status) : "Status unknown"];
  if (typeof pa.requestedAmount === "number") parts.push(formatAud(Math.abs(pa.requestedAmount)));
  return parts.join(" · ");
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 py-1 text-[0.875rem] max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:border-b max-sm:border-[hsl(var(--e-border))] max-sm:py-3 max-sm:last:border-b-0">
      <dt className="text-[hsl(var(--e-text-secondary))]">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere] max-sm:text-right">{children}</dd>
    </div>
  );
}

function Thumb({ url, label, alt }: { url: string | null | undefined; label?: string; alt: string }) {
  const frame = "relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))]";
  if (url === null) {
    return (
      <div role="img" aria-label={`${alt}: photo unavailable`} className={cn(frame, "flex items-center justify-center border-dashed p-1 text-center text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]")}>
        Photo unavailable
      </div>
    );
  }
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className={cn(frame, !url && "pointer-events-none animate-pulse")} aria-label={url ? alt : `${alt}: loading`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
      {label ? (
        <span className="absolute inset-x-1 bottom-1 truncate rounded-[4px] bg-[hsl(160_18%_10%/0.78)] px-1 text-[0.625rem] font-[600] text-white">{label}</span>
      ) : null}
    </a>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] border border-dashed border-[hsl(var(--e-border-strong))] p-1 text-center text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">{children}</p>;
}

function Evidence({ issue, urls }: { issue: QualityIssueRow; urls: EvidenceUrls }) {
  const photos = qaPhotos(issue.qaPhotoKeys);
  const before = keyList(issue.rectificationBeforeKeys);
  const after = keyList(issue.rectificationAfterKeys);
  const fixed = isFixedStatus(issue.rectificationStatus);
  return (
    <div className="space-y-3">
      <div>
        <SectionLabel>QA photos {photos.length}</SectionLabel>
        {photos.length ? (
          <div className="flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <Thumb key={photo.key} url={urls[photo.key]} label={photo.markedUp ? "Marked up" : undefined} alt={`QA photo ${index + 1}${photo.markedUp ? ", marked up" : ""}`} />
            ))}
          </div>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No QA photo on this issue.</p>
        )}
      </div>
      <div>
        <SectionLabel>Before and after the fix</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {before.length ? before.map((key, index) => <Thumb key={key} url={urls[key]} label="Before" alt={`Before the fix ${index + 1}`} />) : <Placeholder>No before photo yet</Placeholder>}
          {after.length ? (
            after.map((key, index) => <Thumb key={key} url={urls[key]} label="After" alt={`After the fix ${index + 1}`} />)
          ) : (
            <Placeholder>{fixed ? "No after photo" : "No after photo yet"}</Placeholder>
          )}
        </div>
      </div>
    </div>
  );
}

function confirmLabel(deduction: number | null, short: boolean): string {
  if (deduction === null) return "Confirm";
  return short ? `Confirm, −${deduction}` : `Confirm, −${deduction} points`;
}

function FalseConfirmationCard({
  issue,
  canManage,
  deduction,
  busy,
  showButtons,
  onDecide,
}: {
  issue: QualityIssueRow;
  canManage: boolean;
  deduction: number | null;
  busy: boolean;
  showButtons: boolean;
  onDecide: (decision: "CONFIRMED" | "REJECTED") => void;
}) {
  const who = issue.cleaner?.name?.split(" ")[0] || "The cleaner";
  const effect =
    deduction === null
      ? "Confirm keeps the false-confirmation deduction from Settings › Accountability on the score; Reject gives those points back. It is not money."
      : `Confirm keeps the −${deduction} point false-confirmation deduction from Settings › Accountability on the score; Reject gives those points back. It is not money.`;
  return (
    <EToneCard
      tone="attention"
      header={
        <>
          <p className="text-[0.875rem] font-[650]">Suspected false confirmation</p>
          <p className="text-[0.8125rem] opacity-80">{who} marked this item complete; the inspector flagged it.</p>
        </>
      }
      pill={canManage ? "Decide" : "Waiting for the office"}
    >
      <div className="space-y-2">
        {showButtons ? (
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="danger" disabled={busy} onClick={() => onDecide("CONFIRMED")}>
              {confirmLabel(deduction, false)}
            </EButton>
            <EButton size="sm" variant="outline" disabled={busy} onClick={() => onDecide("REJECTED")}>
              Reject
            </EButton>
          </div>
        ) : null}
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{effect}</p>
      </div>
    </EToneCard>
  );
}

export function IssuePanel({
  issue,
  categoryLabel,
  canManage,
  initialAction = null,
  falseConfirmationDeduction,
  timeZone,
  draft,
  onDraft,
  onClose,
  onChanged,
}: IssuePanelProps) {
  const phone = useIsPhone();
  const [action, setAction] = React.useState<IssueActionKey | null>(initialAction);
  const actions = useIssueSubmit(issue.id, onChanged);
  const evidenceKeys = React.useMemo(
    () => [...qaPhotos(issue.qaPhotoKeys).map((photo) => photo.key), ...keyList(issue.rectificationBeforeKeys), ...keyList(issue.rectificationAfterKeys)],
    [issue],
  );
  const urls = useEvidenceUrls(evidenceKeys, issue.jobId);
  const propertyName = issue.job?.propertyName ?? issue.property?.name ?? "–";
  const suspected = issue.falseConfirmation === "SUSPECTED";
  const title = issueTitle(issue.description);
  const showQuote = title !== issue.description.trim();

  const run = React.useCallback(
    (body: IssueActionBody, message: string) => {
      void actions.submit(body, message);
    },
    [actions],
  );
  const save = React.useCallback(
    (body: IssueActionBody) => {
      const message =
        body.action === "rectify" ? "Fix recorded" : body.action === "proposeDeduction" ? "Deduction proposed: it waits in Approvals" : body.action === "escalate" ? "Issue escalated" : "Saved";
      run(body, message);
    },
    [run],
  );
  const decide = (decision: "CONFIRMED" | "REJECTED") =>
    run({ action: "falseConfirmation", decision }, decision === "CONFIRMED" ? "False confirmation confirmed" : "False confirmation rejected");

  function chooseAction(key: IssueActionKey | null) {
    actions.clearError();
    setAction(key);
  }

  function renderForm(key: IssueActionKey, layout: "inline" | "sheet") {
    const shell = { layout, busy: actions.busy, error: actions.error, onCancel: () => chooseAction(null) };
    if (key === "rectify") return <RectifyForm issue={issue} draft={draft.rectify} onDraft={(rectify) => onDraft({ ...draft, rectify })} onSave={save} {...shell} />;
    if (key === "deduction") return <DeductionForm issue={issue} draft={draft.deduction} onDraft={(deduction) => onDraft({ ...draft, deduction })} onSave={save} {...shell} />;
    return <EscalateForm draft={draft.escalate} onDraft={(escalate) => onDraft({ ...draft, escalate })} onSave={save} {...shell} />;
  }

  const actionButtons: Array<{ key: IssueActionKey; label: string }> = [
    { key: "rectify", label: "Mark rectification" },
    { key: "deduction", label: "Propose deduction" },
    { key: "escalate", label: "Escalate" },
  ];

  return (
    <>
      <ESidePanel
        open
        label="QA issue"
        title={title}
        onClose={onClose}
        toolbar={
          <p className="text-[0.6875rem] font-[650] uppercase tracking-[0.1em] text-[hsl(var(--e-accent-portal))]">
            QA issue · {categoryLabel}
            {phone ? <span className="normal-case tracking-normal text-[hsl(var(--e-muted-foreground))]"> · {propertyName}</span> : null}
          </p>
        }
        className="lg:w-[360px] xl:w-[400px]"
      >
        {/* One non-shrinking column: the panel scrolls; its cards never squash. */}
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <EPill tone={severityTone(issue.severity)}>{severityLabel(issue.severity)}</EPill>
            <EPill tone={rectificationTone(issue.rectificationStatus)}>{rectificationLabel(issue.rectificationStatus)}</EPill>
            {issue.falseConfirmation && issue.falseConfirmation !== "NONE" ? (
              <EPill tone={falseConfirmationTone(issue.falseConfirmation)}>{`${falseConfirmationLabel(issue.falseConfirmation)} false confirmation`}</EPill>
            ) : null}
            {issue.guestReadyImpact ? <EPill tone="bad">Guest-ready impact</EPill> : null}
            {issue.cleanerMarkedComplete ? <EPill tone="info">Cleaner marked complete</EPill> : null}
            {isNoAfterPhoto(issue) ? <EPill>No after photo</EPill> : null}
          </div>

          <dl className="max-sm:rounded-[var(--e-radius-lg)] max-sm:border max-sm:border-[hsl(var(--e-border))] max-sm:px-3">
            <Fact label="Cleaner">{issue.cleaner?.name || "–"}</Fact>
            <Fact label="Raised by">{issue.raisedBy?.name || "–"}</Fact>
            <Fact label="Property / job">
              {issue.jobId ? (
                <Link href={`/v2/admin/jobs/${issue.jobId}`} className="underline underline-offset-2">
                  {propertyName}
                  {issue.job?.jobNumber ? ` · ${issue.job.jobNumber}` : ""}
                </Link>
              ) : (
                propertyName
              )}
            </Fact>
            <Fact label="Raised">{formatIssueMoment(issue.createdAt, timeZone)}</Fact>
            {issue.raisedFromCaseId ? (
              <Fact label="Raised from">
                <Link href={caseHref(issue.raisedFromCaseId)} className="underline underline-offset-2">A case</Link>
              </Fact>
            ) : null}
            <Fact label="Linked review">
              {issue.review ? (
                canManage && issue.inspectionAssignmentId ? (
                  <Link href={`/v2/admin/quality/${issue.inspectionAssignmentId}`} className="underline underline-offset-2">
                    {typeof issue.review.score === "number" ? `Inspection, score ${Math.round(issue.review.score)}` : "Inspection"}
                  </Link>
                ) : typeof issue.review.score === "number" ? (
                  `Score ${Math.round(issue.review.score)}`
                ) : (
                  "Score not recorded"
                )
              ) : (
                "None"
              )}
            </Fact>
            <Fact label="Pay adjustment">{payAdjustmentText(issue)}</Fact>
            <Fact label="Fix minutes">{issue.rectificationMinutes != null ? `${issue.rectificationMinutes} min` : "Not recorded"}</Fact>
            {issue.rectifiedBy?.name ? <Fact label="Fixed by">{issue.rectifiedBy.name}</Fact> : null}
          </dl>

          {showQuote ? <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))] [overflow-wrap:anywhere]">&ldquo;{issue.description.trim()}&rdquo;</p> : null}

          <Evidence issue={issue} urls={urls} />

          {suspected ? (
            <FalseConfirmationCard
              issue={issue}
              canManage={canManage}
              deduction={falseConfirmationDeduction}
              busy={actions.busy}
              showButtons={canManage && !phone}
              onDecide={decide}
            />
          ) : null}

          {canManage && !phone ? (
            <div className="space-y-2">
              <SectionLabel>Actions</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {actionButtons.map((button) => (
                  <EButton
                    key={button.key}
                    size="sm"
                    variant={action === button.key ? "outline-gold" : "outline"}
                    aria-pressed={action === button.key}
                    disabled={actions.busy}
                    onClick={() => chooseAction(action === button.key ? null : button.key)}
                  >
                    {button.label}
                  </EButton>
                ))}
              </div>
              {action ? (
                <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.45)] p-3">{renderForm(action, "inline")}</div>
              ) : null}
              {suspected && actions.error && !action ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{actions.error}</p> : null}
            </div>
          ) : null}

          {!canManage ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Read-only: you can see this issue but not act on it.</p>
          ) : null}

          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Times are {timeZoneName(timeZone)} time. Closing the panel keeps an unsent proposal until you open another issue.
          </p>

        </div>

        {canManage && phone ? (
          <div
            role="group"
            aria-label="Issue decision"
            className="sticky bottom-0 -mx-4 mt-auto shrink-0 space-y-2 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 pb-1 pt-3"
          >
            {actions.error && !action ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{actions.error}</p> : null}
            {suspected ? (
              <div className="grid grid-cols-2 gap-2">
                <EButton variant="outline" disabled={actions.busy} onClick={() => decide("REJECTED")}>
                  Reject
                </EButton>
                <EButton variant="danger" disabled={actions.busy} onClick={() => decide("CONFIRMED")}>
                  {confirmLabel(falseConfirmationDeduction, true)}
                </EButton>
              </div>
            ) : null}
            <div className="flex gap-2">
              <EButton className="flex-1" variant={suspected ? "outline" : "primary"} disabled={actions.busy} onClick={() => chooseAction("rectify")}>
                Mark fixed…
              </EButton>
              <EButton className="flex-1" variant="outline" disabled={actions.busy} onClick={() => chooseAction("deduction")}>
                Propose deduction…
              </EButton>
              <ERowMenu
                label="More issue actions"
                triggerVariant="outline"
                items={[
                  { key: "escalate", label: "Escalate…", onSelect: () => chooseAction("escalate") },
                  ...(issue.jobId ? [{ key: "job", label: "Open job", href: `/v2/admin/jobs/${issue.jobId}` }] : []),
                ]}
              />
            </div>
          </div>
        ) : null}
      </ESidePanel>

      {canManage && phone && action ? (
        <EBottomSheet
          open
          onOpenChange={(open) => {
            if (!open) chooseAction(null);
          }}
          title={ISSUE_ACTION_TITLE[action]}
          busy={actions.busy}
        >
          <div className="px-4 pb-4">{renderForm(action, "sheet")}</div>
        </EBottomSheet>
      ) : null}
    </>
  );
}
