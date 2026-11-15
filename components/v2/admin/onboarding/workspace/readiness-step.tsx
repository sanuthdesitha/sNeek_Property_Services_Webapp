"use client";

/**
 * Step 12: readiness and activate. The approval check as a checklist; what
 * activation creates; Activate (tier A) through the existing approval; Reject
 * (tier A with a reason pick); and the activated result.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import { jobTypeLabel } from "@/lib/onboarding/workspace/readiness";
import type { OnboardingWorkspaceView } from "@/lib/onboarding/workspace/view-types";
import { ChecklistMark, ONB_MUTED, formatClock } from "./onboarding-kit";

type ActivateAnswer = { propertyId?: string; jobIds: string[]; warnings: string[]; alreadyApproved: boolean };

function errorText(body: unknown, fallback: string): string {
  return body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : fallback;
}

export function ReadinessStep({ view, hasUnsaved, onActivated, onRejected, onBusyChange }: { view: OnboardingWorkspaceView; hasUnsaved: boolean; onActivated: () => Promise<void>; onRejected: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const readiness = view.readiness;
  const hasCalendar = Boolean(view.values.calendar.icalUrl);
  const [createJobs, setCreateJobs] = React.useState(!hasCalendar);
  const [confirm, setConfirm] = React.useState<"activate" | "reject" | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [answer, setAnswer] = React.useState<ActivateAnswer | null>(null);

  const required = readiness.items.filter((item) => item.required);
  const recommended = readiness.items.filter((item) => !item.required);
  const values = view.values;
  const rates = values.pricing.rates.filter((rate) => typeof rate.clientRate === "number" && values.scope.selectedJobTypes.includes(rate.jobType));
  const accessCount = values.access.entries.length + view.legacyAccess.length;
  const creates: Array<{ title: string; detail: string }> = [
    { title: "Property", detail: `${values.basics.propertyName || "Unnamed"}, under ${view.clientName ?? "no client yet"}` },
    { title: "Calendar link", detail: hasCalendar ? "Saved switched off; turn it on from the property's calendar settings to start turnovers" : "None" },
    { title: "Cleaner forms", detail: values.scope.selectedJobTypes.length ? `Property form for each ticked type (${values.scope.selectedJobTypes.map(jobTypeLabel).join(", ")}), checklist profile` : "None: no job type ticked" },
    { title: "Access guide", detail: accessCount ? `${accessCount} entr${accessCount === 1 ? "y" : "ies"}, codes encrypted` : "Nothing yet" },
    { title: "Laundry", detail: values.laundry.hasLaundry ? `${view.laundryPartnerName ?? "No partner"}, ${values.laundry.linenBufferSets ?? "no"} spare sets${values.laundry.bagColor || values.laundry.bagLabel ? `, ${[values.laundry.bagColor, values.laundry.bagLabel].filter(Boolean).join(" · ")} bag` : ""}` : values.laundry.hasLaundry === false ? "No laundry service" : "Off (not answered)" },
    { title: "Rates", detail: rates.length ? `${rates.length} client rate${rates.length === 1 ? "" : "s"}` : "None" },
    { title: "Stock", detail: values.stock.consumablesProvided ? (values.stock.rows.length ? `${values.stock.rows.length} items from the list` : "The full default set, as today") : "Not tracked" },
  ];

  const activate = async () => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${view.id}/activate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ createInitialJobs: createJobs, baseRevision: view.revision }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(`It was not activated: ${errorText(body, "the server refused it.")}`);
        return;
      }
      setAnswer(body as ActivateAnswer);
      setConfirm(null);
      await onActivated();
    } catch {
      setError("It was not activated: no connection. Try again.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  const reject = async (reason: string | undefined) => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/onboarding/surveys/${view.id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(`It was not rejected: ${errorText(body, "the server refused it.")}`);
        return;
      }
      setConfirm(null);
      await onRejected();
    } catch {
      setError("It was not rejected: no connection. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (view.status === "APPROVED" && view.activation) {
    const warnings = answer?.warnings ?? view.activation.warnings;
    return (
      <EToneCard tone="good" bodyClassName="p-0" header={<p className="font-[600]">{`Activated${view.activation.activatedAt ? ` ${formatClock(view.activation.activatedAt, view.timezone)}` : ""}`}</p>} pill="Property created">
        <div className="space-y-3 p-4">
          <p className={ONB_MUTED}>{view.activation.activatedByName ?? "The office"} activated it.</p>
          <p>
            {view.activation.propertyName} is live.{hasCalendar ? " The calendar link is saved switched off; nothing syncs until it is turned on." : ""}
            {answer && answer.jobIds.length ? ` ${answer.jobIds.length} first draft job${answer.jobIds.length === 1 ? "" : "s"} created.` : ""}
          </p>
          {warnings.length ? (
            <EToneNotice tone="attention" title={`${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}>
              <ul className="list-disc pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </EToneNotice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <EButton asChild><Link href={`/v2/admin/properties/${view.activation.propertyId}`}>Open property</Link></EButton>
            <EButton asChild variant="outline"><Link href={`/v2/admin/jobs/new?propertyId=${view.activation.propertyId}`}>Create first job</Link></EButton>
          </div>
        </div>
      </EToneCard>
    );
  }

  if (view.status === "REJECTED") {
    return <EToneNotice tone="problem" title="Rejected">{view.rejectionReason ?? "No reason was recorded."} The onboarding is kept with its answers.</EToneNotice>;
  }

  return (
    <div className="space-y-4">
      <EToneCard tone={readiness.ready ? "good" : "problem"} bodyClassName="p-0" header={<p className="font-[600]">{readiness.ready ? "Ready to activate" : "Not ready yet"}</p>} pill={`Required ${readiness.requiredDone} of ${readiness.requiredTotal}`}>
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          {[{ title: "Required", items: required }, { title: "Recommended", items: recommended }].map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-2 text-[0.75rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-text-secondary))]">{group.title}</h3>
              <ul className="space-y-1.5 text-[0.8125rem]">
                {group.items.map((item) => (
                  <li key={item.key} className="flex items-start gap-2">
                    <ChecklistMark mark={item.state === "done" ? "done" : item.required ? "required" : "recommended"} className="mt-0.5 h-5 w-5" />
                    <span className="min-w-0 break-words"><span className="font-[550]">{item.label}</span>: {item.state === "skipped" ? "skipped" : item.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </EToneCard>

      <section aria-labelledby="activation-creates" className="space-y-2">
        <h3 id="activation-creates" className="text-[0.75rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-text-secondary))]">Activation creates</h3>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {creates.map((entry) => (
            <li key={entry.title} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
              <p className="font-[600]">{entry.title}</p>
              <p className={ONB_MUTED}>{entry.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <label className="flex min-h-11 items-center gap-2 text-[0.875rem]">
        <input type="checkbox" checked={createJobs} disabled={busy} onChange={(event) => setCreateJobs(event.target.checked)} />
        <span>Also create first draft jobs <span className={ONB_MUTED}>· {hasCalendar ? "off by default because the calendar will create turnovers" : "on by default: no calendar is linked"}</span></span>
      </label>
      {hasUnsaved ? <EToneNotice tone="attention" role="status">A change is still saving. Activate when the header says Saved.</EToneNotice> : null}
      {error && !confirm ? <EToneNotice tone="problem" role="alert">{error}</EToneNotice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <EButton disabled={!readiness.ready || busy || hasUnsaved} onClick={() => { setError(null); setConfirm("activate"); }}>Activate property…</EButton>
        <EButton variant="outline" disabled={busy} onClick={() => { setError(null); setConfirm("reject"); }}>Reject…</EButton>
        <span className={ONB_MUTED}>Reject keeps the onboarding with a reason.</span>
      </div>
      {!readiness.ready ? <p className={ONB_MUTED}>Activate needs: {readiness.missingRequired.map((item) => item.label.toLowerCase()).join(", ")}.</p> : null}

      <EConfirmDialog
        open={confirm === "activate"}
        onClose={() => { if (!busy) setConfirm(null); }}
        tier="ordinary"
        title={`Activate ${values.basics.propertyName || "this property"}?`}
        description={`Creates the property and its setup as listed.${hasCalendar ? " The calendar link is saved switched off." : ""} You can deactivate the property later.`}
        confirmLabel="Activate property"
        busy={busy}
        error={confirm === "activate" ? error : null}
        onConfirm={() => activate()}
      >
        <label className="flex min-h-11 items-center gap-2 text-[0.875rem]">
          <input type="checkbox" checked={createJobs} disabled={busy} onChange={(event) => setCreateJobs(event.target.checked)} />
          Also create first draft jobs
        </label>
      </EConfirmDialog>
      <EConfirmDialog
        open={confirm === "reject"}
        onClose={() => { if (!busy) setConfirm(null); }}
        tier="ordinary"
        title="Reject this onboarding?"
        description="It is kept with its answers and the reason; nothing is created."
        reason={{ choices: REASON_CHOICES.onboardingReject }}
        confirmLabel="Reject onboarding"
        busy={busy}
        error={confirm === "reject" ? error : null}
        onConfirm={(result) => reject(result.reason)}
      />
    </div>
  );
}
