"use client";

/**
 * D2 — the damage investigation page, admin and client.
 *
 * ONE component with an `audience` prop rather than two. The server already
 * assembles one view model for both (lib/damage/investigation.ts); two
 * templates here would reintroduce exactly the drift that abstraction removes —
 * a field shown on one screen and hidden on the other. Admin-only affordances
 * are single `isAdmin` branches, easy to audit in one read.
 *
 * The client never receives a cost or an internal triage note: the API nulls
 * both before the payload leaves the server, so this component cannot leak them
 * even if a branch here were wrong. The rendering rule and the security rule are
 * deliberately not the same mechanism.
 *
 * Repair status is read live from CP-7 rather than stored on the damage row, so
 * what a client sees here is what the repair is actually doing.
 */

import * as React from "react";
import { AlertTriangle, Camera, Loader2, ShieldCheck, Wrench } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput } from "@/components/v2/cleaner/fields";

type Audience = "ADMIN" | "CLIENT";

type Photo = {
  id: string;
  url: string;
  caption: string | null;
  section: string;
  annotated: boolean;
};
type Transition = {
  id: string;
  fromState: string | null;
  toState: string;
  actorName: string | null;
  reason: string | null;
  occurredAt: string;
};
type Maintenance = {
  id: string;
  title: string;
  status: string;
  priority: string;
  scheduledFor: string | null;
  resolvedAt: string | null;
  assignedWorkerName: string | null;
};
type Item = {
  id: string;
  area: string;
  category: string;
  severity: string;
  description: string;
  suspectedCause: string;
  estimatedCost: number | null;
  photos: Photo[];
  caseId: string | null;
  caseState: string | null;
  caseStatus: string | null;
  transitions: Transition[];
  maintenance: Maintenance[];
};
type Report = {
  id: string;
  status: string;
  submittedAt: string | null;
  clientVisible: boolean;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reportedByName: string | null;
  jobId: string;
  propertyName: string | null;
  highestSeverity: string | null;
  items: Item[];
};

const SEVERITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  SEVERE: "danger",
  MAJOR: "danger",
  MODERATE: "warning",
  MINOR: "info",
};

const CAUSE_LABEL: Record<string, string> = {
  GUEST: "Guest",
  WEAR: "Wear and tear",
  PRE_EXISTING: "Already there",
  UNKNOWN: "Not sure",
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DamageInvestigation({
  reportId,
  audience,
}: {
  reportId: string;
  audience: Audience;
}) {
  const isAdmin = audience === "ADMIN";
  const endpoint = isAdmin ? `/api/admin/damage/${reportId}` : `/api/client/damage/${reportId}`;

  const [report, setReport] = React.useState<Report | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(endpoint);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load the damage report.");
      setReport(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function patch(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update the report.");
      setReport(data.report);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 p-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading damage report…
      </p>
    );
  }

  if (!report) {
    return (
      <div className="p-6">
        <EAlert tone="danger">{error ?? "This damage report is not available."}</EAlert>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <ECard>
        <ECardBody className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[1.0625rem] font-[600]">
                <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" />
                Damage report — {report.propertyName ?? "Property"}
              </p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {report.items.length} item{report.items.length === 1 ? "" : "s"} · reported by{" "}
                {report.reportedByName ?? "a cleaner"} · submitted {formatDate(report.submittedAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {report.highestSeverity ? (
                <EBadge tone={SEVERITY_TONE[report.highestSeverity] ?? "neutral"}>
                  {titleCase(report.highestSeverity)}
                </EBadge>
              ) : null}
              <EBadge tone="neutral">{titleCase(report.status)}</EBadge>
            </div>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3">
              <span className="flex items-center gap-1.5 text-[0.8125rem]">
                <ShieldCheck className="h-4 w-4" />
                {report.clientVisible
                  ? "Released — the client can see this report."
                  : "Not released — the client cannot see this yet."}
              </span>
              <div className="ml-auto flex gap-2">
                <EButton
                  size="sm"
                  variant={report.clientVisible ? "outline" : undefined}
                  disabled={busy}
                  onClick={() => patch({ action: "REVIEW", release: !report.clientVisible })}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {report.clientVisible ? "Retract from client" : "Release to client"}
                </EButton>
              </div>
              {report.reviewedAt ? (
                <p className="w-full text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Last reviewed {formatDate(report.reviewedAt)}
                  {report.reviewedByName ? ` by ${report.reviewedByName}` : ""}
                </p>
              ) : null}
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {error ? <EAlert tone="danger">{error}</EAlert> : null}

      {report.items.map((item, index) => (
        <ECard key={item.id}>
          <ECardBody className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[0.9375rem] font-[600]">
                {index + 1}. {item.category} — {item.area}
              </p>
              <div className="flex items-center gap-2">
                <EBadge tone={SEVERITY_TONE[item.severity] ?? "neutral"}>
                  {titleCase(item.severity)}
                </EBadge>
                <EBadge tone="neutral">
                  Cause: {CAUSE_LABEL[item.suspectedCause] ?? titleCase(item.suspectedCause)}
                </EBadge>
              </div>
            </div>

            <p className="whitespace-pre-wrap text-[0.875rem]">{item.description}</p>

            {item.photos.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {item.photos.map((photo) => (
                  <figure key={photo.id} className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={photo.caption ?? `${item.category} — ${titleCase(photo.section)}`}
                      className="aspect-square w-full rounded-[var(--e-radius-md)] object-cover"
                    />
                    <figcaption className="flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                      <Camera className="h-3 w-3" />
                      {titleCase(photo.section)}
                      {photo.annotated ? " · marked up" : ""}
                      {photo.caption ? ` · ${photo.caption}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : null}

            {/* Live from CP-7 — the case and its repair keep each other in sync. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3 text-[0.8125rem]">
              <span className="text-[hsl(var(--e-muted-foreground))]">Case</span>
              <EBadge tone="info">
                {item.caseState ? titleCase(item.caseState) : "Not opened"}
              </EBadge>
              {item.maintenance.map((m) => (
                <span key={m.id} className="flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5 text-[hsl(var(--e-muted-foreground))]" />
                  <EBadge tone={m.resolvedAt ? "success" : "warning"}>
                    Repair: {titleCase(m.status)}
                  </EBadge>
                  {m.assignedWorkerName ? (
                    <span className="text-[hsl(var(--e-muted-foreground))]">
                      {m.assignedWorkerName}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>

            {item.transitions.length > 0 ? (
              <ol className="space-y-1 border-l border-[hsl(var(--e-border))] pl-3">
                {item.transitions.map((t) => (
                  <li key={t.id} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <span className="font-[600] text-[hsl(var(--e-foreground))]">
                      {titleCase(t.toState)}
                    </span>
                    {t.actorName ? ` · ${t.actorName}` : ""} · {formatDate(t.occurredAt)}
                    {t.reason ? <span className="block">{t.reason}</span> : null}
                  </li>
                ))}
              </ol>
            ) : null}

            {isAdmin ? (
              <div className="border-t border-[hsl(var(--e-border))] pt-3">
                <EField label="Estimated repair cost (AUD) — admin only, never shown to the client">
                  <EInput
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={item.estimatedCost ?? ""}
                    disabled={busy}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const next = raw === "" ? null : Number(raw);
                      if (next !== null && !Number.isFinite(next)) return;
                      if (next === (item.estimatedCost ?? null)) return;
                      patch({ action: "SET_COST", itemId: item.id, estimatedCost: next });
                    }}
                  />
                </EField>
              </div>
            ) : null}
          </ECardBody>
        </ECard>
      ))}
    </div>
  );
}
