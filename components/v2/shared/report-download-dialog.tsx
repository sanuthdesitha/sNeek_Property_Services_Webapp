"use client";

/**
 * D4 — the ONE download dialog.
 *
 * Every document a job can produce goes through here: the cleaning report, the
 * QA report, and damage reports. The codebase already carries four hand-rolled
 * modal shells (jobs-workspace, quotes-pipeline, job-action-hub,
 * reports-manager) that each re-implement `fixed inset-0` instead of using
 * EModal — this exists so damage does not become the fifth.
 *
 * Tone-coded by document kind so the sheet reads as the thing it is before the
 * text is read: cleaning = gold, damage = danger, QA = info.
 *
 * The "include the cleaning report" option is offered at DOWNLOAD time rather
 * than baked into the damage PDF, because whether the two belong together is a
 * per-download judgement — an insurer wants both, an internal triage does not.
 * It downloads them as two files rather than merging: merging two PDFs would
 * need a new dependency, and two named files are easier to forward selectively.
 */

import * as React from "react";
import { Download, FileText, Loader2, ShieldCheck } from "lucide-react";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EAlert, EBadge, EButton } from "@/components/v2/ui/primitives";
import { downloadFromApi } from "@/lib/client/download";

export type DownloadableKind = "CLEANING" | "DAMAGE" | "QA";

const KIND_TONE: Record<DownloadableKind, "gold" | "danger" | "info"> = {
  CLEANING: "gold",
  DAMAGE: "danger",
  QA: "info",
};

const KIND_LABEL: Record<DownloadableKind, string> = {
  CLEANING: "Cleaning report",
  DAMAGE: "Damage report",
  QA: "QA report",
};

export interface DownloadTarget {
  kind: DownloadableKind;
  /** API path that returns the document. */
  url: string;
  /** Suggested filename if the response carries no content-disposition. */
  filename: string;
  /** Short line describing what this document contains. */
  description?: string;
}

export function ReportDownloadDialog({
  open,
  onClose,
  target,
  cleaningCompanion,
}: {
  open: boolean;
  onClose: () => void;
  target: DownloadTarget | null;
  /** When present on a DAMAGE download, offers to grab the clean's report too. */
  cleaningCompanion?: { url: string; filename: string } | null;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [includeCleaning, setIncludeCleaning] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setError(null);
      setIncludeCleaning(false);
    }
  }, [open]);

  if (!target) return null;

  const tone = KIND_TONE[target.kind];

  async function run() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await downloadFromApi(target.url, target.filename);
      // Sequential, not parallel: two concurrent PDF renders contend for the
      // single-flight Playwright lock and the second would queue anyway.
      if (includeCleaning && cleaningCompanion) {
        await downloadFromApi(cleaningCompanion.url, cleaningCompanion.filename);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || "The download failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EModal open={open} onClose={onClose} eyebrow="Download" title={KIND_LABEL[target.kind]}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <EBadge tone={tone}>{KIND_LABEL[target.kind]}</EBadge>
          {target.kind === "DAMAGE" ? (
            <span className="flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <ShieldCheck className="h-3.5 w-3.5" /> Carries a /verify code
            </span>
          ) : null}
        </div>

        {target.description ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            {target.description}
          </p>
        ) : null}

        {target.kind === "DAMAGE" && cleaningCompanion ? (
          <label className="flex items-start gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={includeCleaning}
              onChange={(e) => setIncludeCleaning(e.target.checked)}
            />
            <span>
              Also download the cleaning report for this job
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Downloads as a second file, so you can forward either on its own.
              </span>
            </span>
          </label>
        ) : null}

        {error ? <EAlert tone="danger">{error}</EAlert> : null}

        <div className="flex justify-end gap-2">
          <EButton variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </EButton>
          <EButton
            variant={tone === "gold" ? "gold" : tone === "danger" ? "danger" : "primary"}
            onClick={run}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download
          </EButton>
        </div>
      </div>
    </EModal>
  );
}

/** Small trigger button that opens the dialog for one target. */
export function DownloadButton({
  target,
  cleaningCompanion,
  label,
  variant = "outline",
}: {
  target: DownloadTarget;
  cleaningCompanion?: { url: string; filename: string } | null;
  label?: string;
  variant?: "outline" | "ghost" | "gold" | "primary";
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <EButton size="sm" variant={variant} onClick={() => setOpen(true)}>
        <FileText className="h-4 w-4" />
        {label ?? KIND_LABEL[target.kind]}
      </EButton>
      <ReportDownloadDialog
        open={open}
        onClose={() => setOpen(false)}
        target={target}
        cleaningCompanion={cleaningCompanion}
      />
    </>
  );
}
