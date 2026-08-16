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
import { AlertTriangle, Camera, Loader2, ShieldCheck, Undo2, Wrench } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";

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
type VoidRecord = {
  id: string;
  mode: string;
  reason: string;
  voidedByName: string | null;
  voidedAt: string;
};

type Report = {
  id: string;
  status: string;
  submittedAt: string | null;
  clientVisible: boolean;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reportedByName: string | null;
  acknowledgedAt: string | null;
  acknowledgedName: string | null;
  voids: VoidRecord[];
  jobId: string;
  propertyName: string | null;
  highestSeverity: string | null;
  items: Item[];
};

const VOID_MODES = [
  {
    value: "KEEP_AND_REOPEN",
    label: "Reopen for editing",
    hint: "Keeps everything. The cleaner corrects what is already there.",
  },
  {
    value: "CLEAR_AND_REDO",
    label: "Clear and start again",
    hint: "Archives the current answers and gives the cleaner a blank form.",
  },
] as const;

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

/**
 * Send the report back to the cleaner.
 *
 * The reason is mandatory and shown to them verbatim — a void with no usable
 * reason just produces the same report again. The mode is an explicit choice
 * rather than a default because the two are not interchangeable: one preserves
 * the evidence for editing, the other archives it and starts over.
 */
function VoidPanel({
  busy,
  onVoid,
}: {
  busy: boolean;
  onVoid: (mode: string, reason: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<string>("KEEP_AND_REOPEN");
  const [reason, setReason] = React.useState("");

  const tooShort = reason.trim().length < 10;

  if (!open) {
    return (
      <ECard>
        <ECardBody className="flex flex-wrap items-center gap-2 pt-6">
          <Undo2 className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
          <span className="text-[0.8125rem]">
            Something wrong with this report? Send it back to the cleaner.
          </span>
          <EButton size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
            Void submission
          </EButton>
        </ECardBody>
      </ECard>
    );
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="text-[0.9375rem] font-[600]">Void this submission</p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Nothing is deleted. The report is archived, un-released from the client, and returned to
          the cleaner with your reason.
        </p>

        <EField label="What should happen to the answers">
          <ESelect value={mode} onChange={(e) => setMode(e.target.value)}>
            {VOID_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} — {m.hint}
              </option>
            ))}
          </ESelect>
        </EField>

        <EField label="Reason (the cleaner sees this)">
          <ETextarea
            rows={3}
            value={reason}
            placeholder="e.g. The close-up photos are too blurry to show the crack — please retake them."
            onChange={(e) => setReason(e.target.value)}
          />
        </EField>

        <div className="flex justify-end gap-2">
          <EButton variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </EButton>
          <EButton
            variant="danger"
            size="sm"
            disabled={busy || tooShort}
            onClick={() => onVoid(mode, reason.trim())}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send back to cleaner
          </EButton>
        </div>
        {tooShort ? (
          <p className="text-right text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Give at least a sentence of reason.
          </p>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

/** The client's in-portal sign-off — the half of verification the code cannot do. */
function AcknowledgePanel({ reportId, onDone }: { reportId: string; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/damage/${reportId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedName: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not record your acknowledgement.");
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="text-[0.9375rem] font-[600]">Acknowledge this report</p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Confirming you have read this record. The code on the PDF proves the document is genuine;
          this records that you have seen it.
        </p>
        <EField label="Your name">
          <EInput
            value={name}
            placeholder="Full name of the person signing off"
            onChange={(e) => setName(e.target.value)}
          />
        </EField>
        {error ? <EAlert tone="danger">{error}</EAlert> : null}
        <div className="flex justify-end">
          <EButton size="sm" disabled={busy || name.trim().length < 2} onClick={submit}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Acknowledge
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
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

          {/* The client's sign-off, shown to both sides. Pairs with the /verify
              code on the PDF: the code proves the document, this proves they
              accepted it. */}
          {report.acknowledgedAt ? (
            <div className="flex items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3 text-[0.8125rem]">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-success))]" />
              Acknowledged by {report.acknowledgedName ?? "the client"} on{" "}
              {formatDate(report.acknowledgedAt)}
            </div>
          ) : null}

          {isAdmin && report.voids.length > 0 ? (
            <div className="space-y-1 border-t border-[hsl(var(--e-border))] pt-3">
              <p className="text-[0.75rem] font-[600]">Sent back {report.voids.length}×</p>
              {report.voids.map((v) => (
                <p key={v.id} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {v.mode === "CLEAR_AND_REDO" ? "Cleared and redone" : "Reopened for editing"} ·{" "}
                  {formatDate(v.voidedAt)}
                  {v.voidedByName ? ` · ${v.voidedByName}` : ""} — {v.reason}
                </p>
              ))}
            </div>
          ) : null}
        </ECardBody>
      </ECard>

      {error ? <EAlert tone="danger">{error}</EAlert> : null}

      {isAdmin && report.status !== "DRAFT" ? (
        <VoidPanel busy={busy} onVoid={(mode, reason) => patch({ action: "VOID", mode, reason })} />
      ) : null}

      {!isAdmin && !report.acknowledgedAt ? (
        <AcknowledgePanel reportId={report.id} onDone={load} />
      ) : null}

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
