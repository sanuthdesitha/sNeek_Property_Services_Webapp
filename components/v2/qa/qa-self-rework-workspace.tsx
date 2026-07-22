"use client";

/**
 * ESTATE v2 — QA SELF-REWORK workspace.
 *
 * Rework decision path (c): the inspector fixed the flagged items themselves.
 * The checklist is the SAME schema the cleaner would have received — served by
 * GET /api/qa/jobs/[id]/self-rework, built by `buildReworkFormSchema` — and the
 * submission is a time/pay claim that lands as a PENDING QaReworkTransfer:
 *
 *   GET  /api/qa/jobs/[id]/self-rework  → { schema, areas, photoUrls, onSiteMinutes }
 *   POST /api/qa/jobs/[id]/self-rework  → { minutes, amount, data } ⇒ PENDING
 *
 * Nothing here reaches payroll: an admin approves the transfer first.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock, Loader2, RotateCcw } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";

type Area = { id: string; label: string; note?: string; photoKeys: string[] };

const SEVERITIES = ["MINOR", "MODERATE", "MAJOR"] as const;

export function QaSelfReworkWorkspace({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [done, setDone] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [minutes, setMinutes] = useState<number>(0);
  const [amount, setAmount] = useState<number>(0);
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("MINOR");
  const [cleanerUserId, setCleanerUserId] = useState<string>("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/qa/jobs/${jobId}/self-rework`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(body.error ?? "Could not load the rework checklist.");
      return;
    }
    setPayload(body);
    setReason(body.reason ?? "");
    setCleanerUserId(body.cleanerCandidates?.[0]?.id ?? "");
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const areas: Area[] = useMemo(() => payload?.areas ?? [], [payload]);
  const onSiteMinutes: number = Number(payload?.onSiteMinutes ?? 0);
  const photoUrls: Record<string, string> = payload?.photoUrls ?? {};
  const allDone = areas.length > 0 && areas.every((a) => done[a.id]);
  const overWindow = minutes > onSiteMinutes + 15;

  async function submit() {
    setError(null);
    if (!cleanerUserId) {
      setError("Choose whose job the rework time comes from.");
      return;
    }
    if (!allDone) {
      setError("Tick every flagged item as fixed before submitting.");
      return;
    }
    if (overWindow) {
      setError(`You recorded ${onSiteMinutes} min on site — the claim has to fit inside that window.`);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/qa/jobs/${jobId}/self-rework`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cleanerUserId,
        minutes,
        amount,
        reason,
        severity,
        affectsCleanerStats: true,
        data: Object.fromEntries(
          areas.map((a) => [a.id, { fixed: Boolean(done[a.id]), note: notes[a.id] ?? "" }])
        ),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not submit the rework claim.");
      return;
    }
    router.push("/v2/qa");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-16 text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading rework checklist…
      </div>
    );
  }

  if (!payload) {
    return (
      <ECard>
        <ECardBody className="space-y-3 pt-6 text-center">
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {error ?? "No rework job exists for this inspection."}
          </p>
          <EButton asChild variant="outline" size="sm">
            <Link href="/v2/qa">Back to today</Link>
          </EButton>
        </ECardBody>
      </ECard>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <EButton asChild variant="ghost" size="icon" className="shrink-0">
          <Link href={`/v2/qa/jobs/${jobId}`} aria-label="Back to inspection">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </EButton>
        <div className="min-w-0 flex-1">
          <p className="e-eyebrow">QA rework · you are fixing this</p>
          <h1 className="e-display-md mt-1 truncate">{payload.job?.property?.name ?? "Property"}</h1>
          <p className="truncate text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {[payload.job?.property?.address, payload.job?.property?.suburb].filter(Boolean).join(", ")}
          </p>
        </div>
        <EBadge tone="warning" soft>
          <Clock className="mr-1 h-3 w-3" />
          {onSiteMinutes} min on site
        </EBadge>
      </div>
      <div className="e-signature-rule" />

      {error ? <EAlert tone="danger">{error}</EAlert> : null}

      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" style={{ color: "hsl(var(--e-warning))" }} /> Flagged items
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          {areas.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              No flagged areas were recorded on this rework.
            </p>
          ) : (
            areas.map((area) => (
              <div key={area.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]"
                    checked={Boolean(done[area.id])}
                    onChange={(e) => setDone((prev) => ({ ...prev, [area.id]: e.target.checked }))}
                  />
                  <span>
                    <span className="text-[0.875rem] font-medium">{area.label}</span>
                    {area.note ? (
                      <span className="block text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{area.note}</span>
                    ) : null}
                  </span>
                </label>
                {area.photoKeys.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {area.photoKeys.map((key) =>
                      photoUrls[key] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={key}
                          src={photoUrls[key]}
                          alt="QA reference"
                          className="h-20 w-20 rounded-[var(--e-radius-sm)] object-cover"
                        />
                      ) : null
                    )}
                  </div>
                ) : null}
                <ETextarea
                  value={notes[area.id] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [area.id]: e.target.value }))}
                  placeholder="What you did to put it right"
                />
              </div>
            ))
          )}
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader>
          <ECardTitle>Time &amp; pay claim</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Whose job it comes from">
              <ESelect value={cleanerUserId} onChange={(e) => setCleanerUserId(e.target.value)}>
                <option value="">Select cleaner</option>
                {(payload.cleanerCandidates ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name || c.email}</option>
                ))}
              </ESelect>
            </EField>
            <EField label="Severity">
              <ESelect value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </ESelect>
            </EField>
            <EField
              label="Minutes spent fixing"
              hint={`Must fit inside your ${onSiteMinutes} min on-site window (+15 min allowance).`}
            >
              <EInput
                type="number"
                min={0}
                value={minutes || ""}
                onChange={(e) => setMinutes(Number(e.target.value || 0))}
              />
            </EField>
            <EField label="Amount to move ($)">
              <EInput
                type="number"
                min={0}
                step="0.01"
                value={amount || ""}
                onChange={(e) => setAmount(Number(e.target.value || 0))}
              />
            </EField>
          </div>
          <EField label="Reason / summary">
            <ETextarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </EField>
          {overWindow ? (
            <EAlert tone="danger">
              {minutes} min exceeds your recorded on-site window of {onSiteMinutes} min.
            </EAlert>
          ) : null}
          <EAlert tone="warning">
            This creates a PENDING rework transfer — the time and pay only move once an admin approves it.
          </EAlert>
          <EButton
            variant="gold"
            size="lg"
            className="w-full"
            disabled={saving || !allDone || overWindow}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving ? "Submitting…" : "Submit rework claim"}
          </EButton>
        </ECardBody>
      </ECard>
    </div>
  );
}
