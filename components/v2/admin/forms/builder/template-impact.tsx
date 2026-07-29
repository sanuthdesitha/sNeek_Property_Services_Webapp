"use client";

/**
 * "Where this template applies" — the guard rail against silent divergence.
 *
 * The reported bug ("what I edit in the forms template doesn't apply, like the
 * section names") is almost never a lost write: the row saves fine, but the job
 * the admin then looks at resolves to a DIFFERENT row (a property override, a
 * generated per-property checklist, or another active global). Nothing in the
 * builder ever said so. This panel says so, using the runtime's own resolution
 * (GET /api/admin/form-templates/[id]/impact).
 *
 * Purely informational — it never blocks a save.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";

export interface TemplateImpact {
  status: "draft" | "published" | "archived";
  isGlobalDefault: boolean;
  globalDefault: { id: string; name: string; version: number } | null;
  propertyScoped: boolean;
  generatedForProperty: { id: string; name: string } | null;
  usedByProperties: Array<{ id: string; name: string }>;
  divergentProperties: Array<{ id: string; name: string }>;
  openJobsUsingThis: number;
  openJobsOfServiceType: number;
  submissionCount: number;
  activeSiblingCount: number;
}

type Tone = "info" | "warning" | "success";

interface Note {
  tone: Tone;
  text: string;
}

/**
 * Pure: impact → the notes shown to the admin. Exported so the rule can be
 * reasoned about (and tested) without rendering.
 */
export function buildImpactNotes(impact: TemplateImpact): Note[] {
  const notes: Note[] = [];

  if (impact.status === "draft") {
    notes.push({
      tone: "warning",
      text: "Draft — saving stores your edits but no cleaner sees them. Press Publish to make this template live.",
    });
  } else if (impact.status === "archived") {
    notes.push({
      tone: "warning",
      text: "Archived — this template is retired. Edits here will not reach any job until it is published again.",
    });
  }

  if (impact.generatedForProperty) {
    notes.push({
      tone: "warning",
      text: `Generated from ${impact.generatedForProperty.name}'s checklist profile. Re-approving that property's checklist creates a NEW template and archives this one — these manual edits would be discarded. Change the checklist library or the property's checklist profile instead if you want the change to stick.`,
    });
  } else if (impact.propertyScoped) {
    const names = impact.usedByProperties.map((p) => p.name).join(", ");
    notes.push({
      tone: "info",
      text: `Property-specific template — used only by ${names}. It is never the global default for this service type.`,
    });
  }

  if (impact.status === "published" && !impact.propertyScoped) {
    if (impact.isGlobalDefault) {
      notes.push({
        tone: "success",
        text: "This is the live default for its service type — any property without its own override renders these edits.",
      });
    } else {
      notes.push({
        tone: "warning",
        text: impact.globalDefault
          ? `Not the live default. Jobs currently render "${impact.globalDefault.name}" (v${impact.globalDefault.version}) instead. Publish this template to make it the default, or edit that one.`
          : "Not the live default for its service type.",
      });
    }
  }

  if (impact.divergentProperties.length > 0) {
    const names = impact.divergentProperties.slice(0, 4).map((p) => p.name);
    const extra = impact.divergentProperties.length - names.length;
    notes.push({
      tone: "warning",
      text: `${impact.divergentProperties.length} propert${
        impact.divergentProperties.length === 1 ? "y overrides" : "ies override"
      } this service type with their own form (${names.join(", ")}${extra > 0 ? `, +${extra} more` : ""}). Edits here will NOT reach ${
        impact.divergentProperties.length === 1 ? "it" : "them"
      }.`,
    });
  }

  if (impact.openJobsUsingThis === 0) {
    notes.push({
      tone: "warning",
      text: `No open job currently resolves to this template${
        impact.openJobsOfServiceType > 0
          ? ` (${impact.openJobsOfServiceType} open job${impact.openJobsOfServiceType === 1 ? "" : "s"} of this service type use another one)`
          : ""
      } — you may be editing the wrong template.`,
    });
  } else {
    notes.push({
      tone: "info",
      text: `${impact.openJobsUsingThis} open job${impact.openJobsUsingThis === 1 ? "" : "s"} will render these edits (jobs pick the template up live, no re-assignment needed).`,
    });
  }

  if (impact.submissionCount > 0) {
    notes.push({
      tone: "info",
      text: `${impact.submissionCount} completed submission${
        impact.submissionCount === 1 ? "" : "s"
      } keep the form exactly as it was when submitted — by design, reports never change retroactively.`,
    });
  }

  return notes;
}

const TONE_CLASS: Record<Tone, string> = {
  info: "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-sunken))]",
  warning: "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))]",
  success: "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))]",
};

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "warning") return <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />;
  if (tone === "success") return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />;
  return <Info className="mt-0.5 size-3.5 shrink-0" />;
}

export function TemplateImpactPanel({ templateId, refreshKey }: { templateId: string; refreshKey?: number }) {
  const [impact, setImpact] = React.useState<TemplateImpact | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/form-templates/${templateId}/impact`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not load template impact.");
      setImpact(body as TemplateImpact);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Could not load template impact.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  React.useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (error) {
    return (
      <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Where this template applies: unavailable ({error}).
      </p>
    );
  }
  if (!impact) {
    return (
      <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">Checking where this template applies…</p>
    );
  }

  const notes = buildImpactNotes(impact);

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
          Where this template applies
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))] hover:underline"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Recheck
        </button>
      </div>
      {notes.map((note, i) => (
        <div
          key={`${note.tone}-${i}`}
          className={`flex items-start gap-2 rounded-[var(--e-radius)] border-l-[3px] px-3 py-1.5 text-[0.75rem] text-[hsl(var(--e-foreground))] ${TONE_CLASS[note.tone]}`}
        >
          <ToneIcon tone={note.tone} />
          <span>{note.text}</span>
        </div>
      ))}
    </div>
  );
}
