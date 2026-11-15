"use client";

/**
 * The inspection record, /v2/admin/quality/[assignmentId] once an inspection
 * is submitted (board "QualityInspection"; phone board "M-QualityDetail",
 * frames 4 and 5). The office view of the shared inspection: findings by area
 * on the left; what the office decides on the right (accountability score, AI
 * photo review, who fixes it, sign-off).
 *
 * Everything that changes something goes through an existing endpoint: the
 * reopen route (tier A dialog with the required reason and the money already
 * moved), the AI photo review route (tier A dialog to approve a deduction),
 * and the QA issue actions in the Issues tab. The full shared inspection
 * workspace stays one click away ("More" → Open inspection workspace).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { ESectionSwitcher } from "@/components/v2/ui/phone-bars";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EField, ETextarea } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { REOPEN_REASON_MIN_LENGTH } from "@/lib/qa/reopen";
import type { InspectionRecord } from "@/lib/quality/inspection-record-types";
import { useEvidenceUrls } from "../issues/issue-evidence";
import { RecordFindings } from "./record-findings";
import { RecordAiReview } from "./record-ai-review";
import { DamageCard, EvidenceCard, NextCleanCard, ScoreCard, SignOffCard, WhoFixesCard, moment } from "./record-cards";

const PHONE_SECTIONS = [
  { id: "record-findings", label: "Findings" },
  { id: "record-ai", label: "AI review" },
  { id: "record-fix", label: "Fix" },
  { id: "record-evidence", label: "Evidence" },
  { id: "record-signoff", label: "Sign-off" },
];

function serviceDay(record: InspectionRecord): string | null {
  if (!record.serviceDate) return null;
  // A calendar day: read as noon UTC so no viewer time zone moves it.
  return formatInTimeZone(new Date(`${record.serviceDate}T12:00:00Z`), "UTC", "EEE d MMM");
}

function headerLine(record: InspectionRecord): string {
  const parts: string[] = [[record.jobTypeLabel, serviceDay(record)].filter(Boolean).join(", ")];
  if (record.cleanerNames.length) parts.push(`cleaned by ${record.cleanerNames.join(", ")}`);
  const inspected: string[] = [];
  if (record.inspectorName) inspected.push(`inspected by ${record.inspectorName}`);
  if (record.checkIn.method === "gps") inspected.push(`checked in with GPS ${moment(record.checkIn.at, record.timeZone, "HH:mm") ?? ""}`.trim());
  else if (record.checkIn.method === "remote") inspected.push("reviewed remotely");
  else inspected.push("no check-in recorded");
  const submitted = moment(record.submittedAt, record.timeZone, "HH:mm");
  if (submitted) inspected.push(`submitted ${submitted}`);
  return `${parts.join(" · ")} · ${inspected.join(", ")}.`;
}

/** Every key the record shows as a photo, resolved through the shared access rail. */
function photoKeys(record: InspectionRecord): string[] {
  const keys = new Set<string>();
  for (const area of record.areas) for (const item of area.items) item.issue?.qaPhotos.slice(0, 1).forEach((photo) => keys.add(photo.key));
  record.damage.forEach((entry) => entry.photoKeys.slice(0, 1).forEach((key) => keys.add(key)));
  record.evidence?.photos.forEach((photo) => keys.add(photo.key));
  if (record.signOff?.signatureKey) keys.add(record.signOff.signatureKey);
  return Array.from(keys);
}

function ReopenDialog({ record, open, onClose }: { record: InspectionRecord; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const short = reason.trim().length < REOPEN_REASON_MIN_LENGTH;

  async function reopen() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/qa/jobs/${encodeURIComponent(record.jobId)}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: record.assignmentId, reason: reason.trim() }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" ? (body as { error?: unknown }).error : null;
        setError(`It was not recorded: ${typeof message === "string" && message && message !== "FORBIDDEN" ? message : "the inspection could not be reopened."}`);
        return;
      }
      toast({ title: "Inspection reopened" });
      setReason("");
      onClose();
      router.refresh();
    } catch {
      setError("It was not recorded: the request failed. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const who = record.inspectorName ?? "The inspector";
  return (
    <EConfirmDialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      tier="ordinary"
      title="Reopen this inspection?"
      description={`${who} can amend and submit again; the changes update this review, and who reopened it and why is recorded.`}
      confirmLabel="Reopen inspection"
      busy={busy}
      confirmDisabled={short}
      error={error}
      onConfirm={reopen}
    >
      {record.reopen.warnings.length ? (
        <ul className="list-disc space-y-1 pl-5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          {record.reopen.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <EField label="Why are you reopening it? Required" hint={`At least ${REOPEN_REASON_MIN_LENGTH} characters. It goes on the record with your name.`}>
        <ETextarea rows={3} disabled={busy} className="max-sm:text-[16px]" value={reason} onChange={(event) => setReason(event.target.value)} />
      </EField>
    </EConfirmDialog>
  );
}

export function InspectionRecordView({ record, canManage }: { record: InspectionRecord; canManage: boolean }) {
  const [reopening, setReopening] = React.useState(false);
  const urls = useEvidenceUrls(photoKeys(record), record.jobId);
  const title = `${record.propertyName}${record.jobNumber ? ` · ${record.jobNumber}` : ""}`;
  const workspaceHref = `/v2/admin/quality/${record.assignmentId}?view=workspace`;

  const reopenButton =
    canManage && record.reopen.eligible ? (
      <EButton size="sm" variant="outline" onClick={() => setReopening(true)}>
        Reopen inspection…
      </EButton>
    ) : null;

  return (
    <div className="space-y-4">
      <EPageHeader
        eyebrow={
          <>
            <Link href="/v2/admin/quality?tab=review" className="underline-offset-2 hover:underline">
              Quality
            </Link>{" "}
            · Inspection record
          </>
        }
        title={title}
        description={headerLine(record)}
        actions={
          <>
            <EButton asChild size="sm" variant="outline">
              <Link href={`/v2/admin/jobs/${record.jobId}`}>{record.jobNumber ? `Open job ${record.jobNumber}` : "Open job"}</Link>
            </EButton>
            {reopenButton}
            <ERowMenu
              label="More inspection actions"
              triggerVariant="outline"
              items={[
                { key: "workspace", label: "Open inspection workspace", href: workspaceHref },
                { key: "report", label: "Download QA report", href: `/api/qa/jobs/${encodeURIComponent(record.jobId)}/report`, newTab: true },
              ]}
            />
          </>
        }
      />
      {canManage && !record.reopen.eligible && record.reopen.blockedReason ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Reopen is not available: {record.reopen.blockedReason}</p>
      ) : null}

      <ESectionSwitcher label="Inspection record sections" sections={PHONE_SECTIONS} />

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        {/* Below lg the two columns dissolve so the phone order (board frame 4) can interleave them. */}
        <div className="flex min-w-0 flex-col gap-4 max-lg:contents">
          <EStageBar
            label="Inspection steps"
            className="max-lg:order-1"
            stages={[
              { key: "before", label: "Before you go", state: record.checkIn.method === "none" ? "passed" : "done", note: record.checkIn.method === "remote" ? "Remote review" : null },
              { key: "inspect", label: "Inspect", state: "done" },
              { key: "submitted", label: "Signed off and submitted", state: "done", note: record.signOff ? null : "No signature recorded" },
            ]}
          />
          <div className="max-lg:order-3">
            <RecordFindings record={record} urls={urls} />
          </div>
          <div className="grid gap-4 md:grid-cols-2 max-lg:order-6">
            <DamageCard record={record} urls={urls} />
            <NextCleanCard record={record} />
          </div>
          <div className="max-lg:order-7">
            <EvidenceCard record={record} urls={urls} />
          </div>
        </div>
        <div className={cn("flex min-w-0 flex-col gap-4 max-lg:contents")}>
          <div className="max-lg:order-2">
            <ScoreCard record={record} />
          </div>
          <div className="max-lg:order-4">
            <RecordAiReview record={record} canManage={canManage} />
          </div>
          <div className="max-lg:order-5">
            <WhoFixesCard record={record} />
          </div>
          <div className="max-lg:order-8">
            <SignOffCard record={record} urls={urls} />
          </div>
        </div>
      </div>

      {reopenButton ? <ReopenDialog record={record} open={reopening} onClose={() => setReopening(false)} /> : null}
    </div>
  );
}
