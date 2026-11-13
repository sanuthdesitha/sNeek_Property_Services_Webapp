"use client";

/**
 * The job page header's actions: one primary action chosen by status, the
 * secondary buttons drawn for that state, and the "More" menu holding every
 * other job action (lib/jobs/job-page/primary-action.ts and more-menu.ts).
 * A disabled action stays visible with its reason. Every action opens an
 * existing dialog or calls an existing route; the routes re-check permission.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { isPhoneNow, PhoneActionSheet } from "@/components/v2/admin/phone-action-sheet";
import { downloadFromApi } from "@/lib/client/download";
import { toast } from "@/hooks/use-toast";
import type { JobPrimaryAction, JobSecondaryAction } from "@/lib/jobs/job-page/primary-action";
import type { JobMenuActionKey, JobMenuEntry } from "@/lib/jobs/job-page/more-menu";
import type { JobPageOpen } from "@/lib/jobs/job-page/deep-link";
import type { JobPageManageJob } from "@/lib/jobs/job-page/rows";
import { QuickQaReview } from "../quick-qa-review";
import { useJobRestore } from "./job-restore";
import { JobActionDialogs, type JobDialogKey } from "./job-action-dialogs";
import { MessageTeamDialog } from "./message-team-dialog";

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

function ActionButton({ action, variant, onPress, idSuffix = "" }: { action: JobPrimaryAction | JobSecondaryAction; variant: "primary" | "outline"; onPress?: () => void; idSuffix?: string }) {
  const reasonId = `reason-${action.kind}${idSuffix}`;
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
  const [messagingTeam, setMessagingTeam] = useState(false);
  const restore = useJobRestore();
  // Phones (board M-JobDetail): the actions dock in a bottom bar and "More"
  // is a bottom sheet with the same items. From 640px up nothing changes.
  const phone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  // An old danger link opens the desktop menu, or the sheet on a phone.
  const [desktopMenuSignal] = useState(() => props.initialOpen === "menu" && !isPhoneNow());
  useEffect(() => {
    if (phone && props.initialOpen === "menu") setSheetOpen(true);
  }, [phone, props.initialOpen]);

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

  function renderSecondary(action: JobSecondaryAction, idSuffix = "") {
    return action.kind === "send-back" ? (
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
      <ActionButton key={action.kind} action={action} variant="outline" idSuffix={idSuffix} onPress={action.kind === "send-reminder" ? () => setDialog("reminder") : undefined} />
    );
  }

  function renderPrimary(primary: JobPrimaryAction, idSuffix = "") {
    return (
      <ActionButton
        action={primary.kind === "restore" && restore?.state.kind === "saving" ? { ...primary, label: "Restoring…", disabledReason: "Restoring…" } : primary}
        variant="primary"
        idSuffix={idSuffix}
        onPress={primary.kind === "restore" ? () => void restore?.restore() : primary.kind === "message-team" ? () => setMessagingTeam(true) : undefined}
      />
    );
  }

  // Phone bar: "More", one secondary and the primary. Other secondaries lead
  // the sheet. "Send back for rework" owns a dialog that cannot open inside
  // the docked bar, so on a phone it jumps to the Submitted stage, which
  // carries the same button (with "Approve and complete").
  const barSecondary = props.secondary.find((action) => action.kind !== "send-back") ?? null;
  const sheetSecondaries = props.secondary.filter((action) => action !== barSecondary);
  const sheetItems: ERowMenuItem[] = [
    ...sheetSecondaries.map((action, index): ERowMenuItem => ({
      key: `status-${action.kind}`,
      label: action.label,
      disabled: action.disabledReason !== null,
      hint: action.disabledReason ?? undefined,
      href: action.kind === "send-back" ? "#s-submitted" : action.href ?? undefined,
      heading: index === 0 ? "This job now" : undefined,
      onSelect: action.href || action.kind === "send-back" ? undefined : action.kind === "send-reminder" ? () => setDialog("reminder") : undefined,
    })),
    ...items.map((item, index) => (index === 0 && sheetSecondaries.length > 0 && !item.heading ? { ...item, heading: "Job" } : item)),
  ];
  const moreButton = (
    <EButton key="more" variant="outline" size="icon" aria-label="More job actions" aria-haspopup="dialog" aria-expanded={sheetOpen} onClick={() => setSheetOpen(true)}>
      <MoreHorizontal aria-hidden className="h-4 w-4" />
    </EButton>
  );

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 max-sm:contents">
      <div className="contents max-sm:hidden">
        {props.secondary.map((action) => renderSecondary(action))}
        {props.primary ? renderPrimary(props.primary) : null}
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
          openSignal={desktopMenuSignal}
        />
      </div>
      {phone ? (
        <>
          {/* The bar sits inside the header, so its own end-of-page spacer is hidden here; the page adds one at its end. */}
          <div className="contents [&>[aria-hidden]]:hidden">
          <EPhoneActionBar
            label="Job actions"
            secondary={
              <>
                {moreButton}
                {barSecondary ? renderSecondary(barSecondary, "-phone") : null}
              </>
            }
            primary={props.primary ? renderPrimary(props.primary, "-phone") : <span className="flex-1" />}
          />
          </div>
          <PhoneActionSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Job actions" items={sheetItems} footnote={props.menuFootnote} />
        </>
      ) : null}
      {messagingTeam ? <MessageTeamDialog key={props.jobId} jobId={props.jobId} onClose={() => setMessagingTeam(false)} /> : null}
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
