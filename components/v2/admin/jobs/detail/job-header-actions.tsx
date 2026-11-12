"use client";

/**
 * The job page header's actions: one primary action chosen by status, the
 * secondary buttons drawn for that state, and the "More" menu holding every
 * other job action (lib/jobs/job-page/primary-action.ts and more-menu.ts).
 * A disabled action stays visible with its reason. Every action opens an
 * existing dialog or calls an existing route; the routes re-check permission.
 */
import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { downloadFromApi } from "@/lib/client/download";
import { toast } from "@/hooks/use-toast";
import type { JobPrimaryAction, JobSecondaryAction } from "@/lib/jobs/job-page/primary-action";
import type { JobMenuActionKey, JobMenuEntry } from "@/lib/jobs/job-page/more-menu";
import type { JobPageOpen } from "@/lib/jobs/job-page/deep-link";
import type { JobPageManageJob } from "@/lib/jobs/job-page/rows";
import { QuickQaReview } from "../quick-qa-review";
import { useJobRestore } from "./job-restore";
import { JobActionDialogs, type JobDialogKey } from "./job-action-dialogs";

export type JobHeaderActionsProps = {
  jobId: string;
  jobLabel: string;
  statusLabel: string;
  status: string;
  primary: JobPrimaryAction | null;
  secondary: JobSecondaryAction[];
  menu: JobMenuEntry[];
  menuFootnote: string;
  initialOpen: JobPageOpen;
  manageJob: JobPageManageJob;
  hasQaReview: boolean;
};

const DIALOG_FOR: Partial<Record<JobMenuActionKey, JobDialogKey>> = {
  "edit-details": "scope",
  reschedule: "schedule",
  "change-status": "people",
  skip: "skip",
  "save-template": "template",
  "send-reminder": "reminder",
  reset: "reset",
  cancel: "cancel",
  delete: "delete",
};

function DisabledReason({ id, text }: { id: string; text: string }) {
  return (
    <span id={id} className="sr-only">
      {text}
    </span>
  );
}

function ActionButton({ action, variant, onPress }: { action: JobPrimaryAction | JobSecondaryAction; variant: "primary" | "outline"; onPress?: () => void }) {
  const reasonId = `reason-${action.kind}`;
  if (action.disabledReason) {
    return (
      <>
        <EButton variant={variant} size="sm" disabled title={action.disabledReason} aria-describedby={reasonId}>
          {action.label}
        </EButton>
        <DisabledReason id={reasonId} text={action.disabledReason} />
      </>
    );
  }
  if (action.href) {
    return (
      <EButton asChild variant={variant} size="sm">
        <Link href={action.href}>{action.label}</Link>
      </EButton>
    );
  }
  return (
    <EButton variant={variant} size="sm" onClick={onPress}>
      {action.label}
    </EButton>
  );
}

export function JobHeaderActions(props: JobHeaderActionsProps) {
  const [dialog, setDialog] = useState<JobDialogKey | null>(props.initialOpen === "reschedule" ? "schedule" : null);
  const restore = useJobRestore();

  async function downloadReport() {
    try {
      await downloadFromApi(`/api/reports/${encodeURIComponent(props.jobId)}/download`, `job-report-${props.jobId}.pdf`);
    } catch (error) {
      toast({ title: "Download failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    }
  }

  const items: ERowMenuItem[] = props.menu.map((entry, index) => {
    const previous = props.menu[index - 1];
    const firstOfGroup = !previous || previous.group !== entry.group;
    return {
      key: entry.key,
      label: entry.label,
      danger: entry.danger,
      disabled: entry.disabledReason !== null,
      hint: entry.disabledReason ?? undefined,
      badge: entry.badge ?? undefined,
      href: entry.href ?? undefined,
      heading: firstOfGroup ? (entry.group === "danger" ? "Danger zone" : "Job") : undefined,
      separated: firstOfGroup && index > 0,
      onSelect: entry.href
        ? undefined
        : entry.key === "download-report"
          ? () => void downloadReport()
          : () => setDialog(DIALOG_FOR[entry.key] ?? null),
    };
  });

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {props.secondary.map((action) =>
        action.kind === "send-back" ? (
          <QuickQaReview
            key={action.kind}
            jobId={props.jobId}
            jobStatus={props.status}
            hasReview={props.hasQaReview}
            intent="rework"
            triggerLabel={action.label}
            disabledReason={action.disabledReason}
          />
        ) : (
          <ActionButton key={action.kind} action={action} variant="outline" onPress={action.kind === "send-reminder" ? () => setDialog("reminder") : undefined} />
        ),
      )}
      {props.primary ? (
        <ActionButton
          action={props.primary.kind === "restore" && restore?.state.kind === "saving" ? { ...props.primary, label: "Restoring…", disabledReason: "Restoring…" } : props.primary}
          variant="primary"
          onPress={props.primary.kind === "restore" ? () => void restore?.restore() : undefined}
        />
      ) : null}
      <ERowMenu
        label="More job actions"
        items={items}
        trigger={
          <>
            More <ChevronDown aria-hidden className="h-3.5 w-3.5" />
          </>
        }
        triggerVariant="outline"
        className="h-8 px-3 text-[0.8125rem]"
        footnote={props.menuFootnote}
        openSignal={props.initialOpen === "menu"}
      />
      <JobActionDialogs
        dialog={dialog}
        onClose={() => setDialog(null)}
        jobId={props.jobId}
        jobLabel={props.jobLabel}
        statusLabel={props.statusLabel}
        manageJob={props.manageJob}
      />
    </div>
  );
}
