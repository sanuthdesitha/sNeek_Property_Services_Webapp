"use client";

/**
 * ProcessNudge — a tasteful, friendly-but-firm reminder that keeps people
 * inside the verified workflow at points where they might be tempted to skip a
 * step. It nudges by explaining *why* the step matters (quality + payment
 * accuracy), never by scolding.
 *
 * Two surfaces:
 *  - <ProcessNudge variant="banner" />  — a passive inline note you mount
 *    near a friction point (or generically in a portal shell).
 *  - <ProcessConfirm ... />             — an active confirm-before-proceed
 *    gate other flows wrap around a "skip / continue anyway" action.
 *
 * Pure presentation + local state; no data fetching, no schema coupling.
 */

import { useState } from "react";
import { ShieldCheck, Info, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type ProcessNudgeTone = "info" | "reassure" | "caution";

const TONE_STYLES: Record<
  ProcessNudgeTone,
  { wrap: string; icon: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  reassure: {
    wrap: "border-emerald-500/25 bg-emerald-500/[0.06] text-foreground",
    icon: "text-emerald-600 dark:text-emerald-400",
    Icon: ShieldCheck,
  },
  info: {
    wrap: "border-primary/20 bg-primary/[0.05] text-foreground",
    icon: "text-primary",
    Icon: Info,
  },
  caution: {
    wrap: "border-amber-500/30 bg-amber-500/[0.07] text-foreground",
    icon: "text-amber-600 dark:text-amber-500",
    Icon: AlertTriangle,
  },
};

const DEFAULT_MESSAGE =
  "This step is part of the verified process and is logged for quality and payment accuracy. Skipping it may delay approval or pay.";

interface ProcessNudgeProps {
  /** Override the body copy. Defaults to the standard process reminder. */
  message?: string;
  /** Optional bolded lead-in shown before the message. */
  title?: string;
  tone?: ProcessNudgeTone;
  className?: string;
  /** Render compact (smaller padding/text) for tight spots. */
  compact?: boolean;
}

/**
 * Passive banner variant. Drop it anywhere as a gentle, professional reminder.
 */
export function ProcessNudge({
  message = DEFAULT_MESSAGE,
  title,
  tone = "info",
  className,
  compact = false,
}: ProcessNudgeProps) {
  const styles = TONE_STYLES[tone];
  const Icon = styles.Icon;
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-xl border",
        compact ? "px-3 py-2" : "px-4 py-3",
        styles.wrap,
        className
      )}
    >
      <Icon className={cn("mt-0.5 shrink-0", compact ? "h-4 w-4" : "h-5 w-5", styles.icon)} />
      <div className={cn("min-w-0", compact ? "text-xs" : "text-sm")}>
        {title ? <p className="font-semibold leading-snug">{title}</p> : null}
        <p className={cn("leading-snug text-muted-foreground", title && "mt-0.5")}>{message}</p>
      </div>
    </div>
  );
}

interface ProcessConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user chooses to proceed anyway (after acknowledging). */
  onConfirm: () => void;
  title?: string;
  /** The explanation of why the step matters. */
  message?: string;
  /** Label on the proceed button (e.g. "Skip and continue"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Require the user to tick an acknowledgement box before the proceed button
   * enables. On by default — it adds just enough friction to make skipping a
   * deliberate, logged choice.
   */
  requireAcknowledgement?: boolean;
  /** Show a spinner / disable buttons while the parent action runs. */
  loading?: boolean;
}

/**
 * Active confirm-before-proceed gate. Wrap it around a "skip / continue
 * anyway" action: the user must consciously acknowledge the reminder before
 * proceeding. Other flows (e.g. the cleaner job flow) wire this in.
 */
export function ProcessConfirm({
  open,
  onOpenChange,
  onConfirm,
  title = "Before you skip this step",
  message = DEFAULT_MESSAGE,
  confirmLabel = "Continue anyway",
  cancelLabel = "Go back",
  requireAcknowledgement = true,
  loading = false,
}: ProcessConfirmProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  function handleOpenChange(next: boolean) {
    if (!next) setAcknowledged(false);
    onOpenChange(next);
  }

  const canProceed = !loading && (!requireAcknowledgement || acknowledged);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">{message}</DialogDescription>
        </DialogHeader>

        {requireAcknowledgement ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-muted/30 px-3 py-3 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              I understand this is part of the verified process and that skipping it is logged and may
              affect approval or pay.
            </span>
          </label>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            disabled={!canProceed}
            onClick={() => {
              onConfirm();
              setAcknowledged(false);
            }}
          >
            {loading ? "Working…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ProcessNudge;
