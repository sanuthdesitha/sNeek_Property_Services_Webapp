"use client";

/**
 * Cleaner-facing "QA feedback" card. Self-fetches the cleaner's recent QA
 * outcomes from GET /api/cleaner/qa-feedback and renders nothing when there are
 * none. Each row shows property + job date, score% + Passed/Failed; expanding
 * ("View feedback") reveals every issue (severity, category, description, QA
 * photos). Unacknowledged reviews are visually prominent and carry an "I've
 * read this" button hitting POST /api/cleaner/qa-feedback/[id]/acknowledge.
 * Modelled on components/v2/cleaner/coaching-card.tsx; Estate v2 styling.
 */
import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";

type Issue = {
  id: string;
  severity: string;
  category: string;
  description: string;
  createdAt: string;
  photoUrls: string[];
};

type Review = {
  id: string;
  score: number | null;
  passed: boolean | null;
  kind: string;
  createdAt: string;
  cleanerAcknowledgedAt: string | null;
  job: {
    id: string;
    jobNumber: string | null;
    scheduledDate: string | null;
    propertyName: string;
    propertySuburb: string | null;
  };
  issues: Issue[];
};

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  try {
    return format(parseISO(value), "dd MMM yyyy");
  } catch {
    return String(value);
  }
}

function humanize(value?: string | null) {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function severityTone(severity: string): "warning" | "danger" | "neutral" {
  if (severity === "CRITICAL" || severity === "MAJOR") return "danger";
  if (severity === "MINOR") return "warning";
  return "neutral";
}

export function CleanerQaFeedbackCard() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cleaner/qa-feedback", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setReviews(body.reviews ?? []);
      else setReviews([]);
    } catch {
      setReviews([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/cleaner/qa-feedback/${id}/acknowledge`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not acknowledge");
      toast({ title: "Marked as read" });
      await load();
    } catch (err: any) {
      toast({ title: "Failed", description: err?.message ?? "Could not acknowledge", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  // Hide entirely when the cleaner has no QA outcomes yet.
  if (!reviews || reviews.length === 0) return null;
  const unseenFirst = [...reviews].sort(
    (a, b) => Number(Boolean(a.cleanerAcknowledgedAt)) - Number(Boolean(b.cleanerAcknowledgedAt))
  );
  const visible = unseenFirst.slice(0, 6);

  return (
    <section className="space-y-3">
      <span className="e-eyebrow flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5" /> QA FEEDBACK
      </span>
      {visible.map((r) => {
        const unseen = !r.cleanerAcknowledgedAt;
        const open = openId === r.id;
        const hasIssues = r.issues.length > 0;
        return (
          <ECard
            key={r.id}
            className={
              unseen
                ? "border-l-[3px] border-l-[hsl(var(--e-gold))]"
                : "border-l-[3px] border-l-[hsl(var(--e-border))]"
            }
          >
            <ECardBody className="space-y-2 pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.875rem] font-medium">
                    {r.job.propertyName}
                    {r.job.propertySuburb ? `, ${r.job.propertySuburb}` : ""}
                  </p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Job {r.job.jobNumber ?? "—"} · {fmt(r.job.scheduledDate)} · Reviewed {fmt(r.createdAt)}
                  </p>
                </div>
                {unseen ? <EBadge tone="gold" soft>New</EBadge> : null}
                <EBadge tone={r.passed === false ? "danger" : "success"} soft>
                  {r.passed === false ? "Failed" : "Passed"}
                  {r.score != null ? ` · ${Math.round(r.score)}%` : ""}
                </EBadge>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {hasIssues ? (
                  <EButton variant="ghost" size="sm" onClick={() => setOpenId(open ? null : r.id)}>
                    {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {open ? "Hide feedback" : `View feedback (${r.issues.length})`}
                  </EButton>
                ) : (
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    No issues raised — nice work.
                  </span>
                )}
                {unseen && !hasIssues ? (
                  // Clean passes can be acknowledged straight from the row.
                  <EButton variant="gold" size="sm" disabled={busyId === r.id} onClick={() => void acknowledge(r.id)}>
                    {busyId === r.id ? "Saving…" : "I've read this"}
                  </EButton>
                ) : null}
                {!unseen ? (
                  <span className="ml-auto text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    Seen {fmt(r.cleanerAcknowledgedAt)}
                  </span>
                ) : null}
              </div>

              {open && hasIssues ? (
                <div className="space-y-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                  {r.issues.map((issue) => (
                    <div key={issue.id} className="space-y-1.5 border-b border-[hsl(var(--e-border))] pb-2.5 last:border-b-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <EBadge tone={severityTone(issue.severity)} soft>
                          {humanize(issue.severity)}
                        </EBadge>
                        <span className="text-[0.75rem] font-medium">{humanize(issue.category)}</span>
                        <span className="ml-auto text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {fmt(issue.createdAt)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        {issue.description}
                      </p>
                      {issue.photoUrls.length > 0 ? (
                        <MediaGallery
                          items={issue.photoUrls.map((url, i) => ({ id: `${issue.id}-${i}`, url, label: "QA photo" }))}
                          title="QA photos"
                          className="grid grid-cols-4 gap-1.5 sm:grid-cols-6"
                        />
                      ) : null}
                    </div>
                  ))}
                  {unseen ? (
                    <EButton
                      variant="gold"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => void acknowledge(r.id)}
                    >
                      {busyId === r.id ? "Saving…" : "I've read this"}
                    </EButton>
                  ) : null}
                </div>
              ) : null}
            </ECardBody>
          </ECard>
        );
      })}
    </section>
  );
}
