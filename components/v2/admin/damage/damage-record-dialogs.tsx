"use client";

/**
 * The damage report page's confirmations, all on the shared EConfirmDialog
 * (board "Confirmations and deletes"):
 *   - Send back to the cleaner: tier C, the existing VOID with its two modes,
 *     a quick-pick reason the cleaner reads, and the person's own PIN, which
 *     the damage route verifies in the same request. A refusal keeps the mode
 *     and reason, clears the PIN and says it was not recorded.
 *   - Release, take back, close without releasing, close, reopen: tier A.
 * And "Preview as the client": the CLIENT view model rendered read-only by
 * the client page's own component.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import { sensitiveVerificationText, type SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import type { DamageReleaseTransport } from "@/lib/damage/release-notice-types";
import { DamageInvestigation } from "@/components/v2/damage/damage-investigation";
import { readClientPreview, type RecordReport } from "./damage-record-api";
import { firstName } from "./damage-record-format";
import type { DecisionKey } from "./damage-record-rail";

export type VoidMode = "KEEP_AND_REOPEN" | "CLEAR_AND_REDO";

const VOID_MODES: ReadonlyArray<{ value: VoidMode; label: string; hint: string }> = [
  { value: "KEEP_AND_REOPEN", label: "Reopen for editing", hint: "Keeps everything; they correct it." },
  { value: "CLEAR_AND_REDO", label: "Clear and start again", hint: "Archives these answers; they get a blank report." },
];

export function SendBackDialog({
  open,
  cleanerName,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  cleanerName: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (mode: VoidMode, reason: string, security: SensitiveCredentialsInput | undefined) => Promise<void>;
}) {
  const [mode, setMode] = React.useState<VoidMode>("KEEP_AND_REOPEN");
  const name = firstName(cleanerName);
  const groupName = React.useId();
  React.useEffect(() => {
    if (!open) setMode("KEEP_AND_REOPEN");
  }, [open]);
  return (
    <EConfirmDialog
      open={open}
      tier="sensitive"
      title={`Send this report back to ${name}?`}
      description={`Nothing is deleted. The report is taken back from review and ${name} sees your reason.`}
      lead={(
        <fieldset disabled={busy} className="space-y-2">
          <legend className="pb-1 text-[0.75rem] font-[650] text-[hsl(var(--e-text-secondary))]">What happens to {name === "the cleaner" ? "their" : `${name}'s`} answers</legend>
          {VOID_MODES.map((option) => (
            <label key={option.value} className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[10px] border px-3 py-2.5", mode === option.value ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))]")}>
              <input type="radio" name={groupName} value={option.value} checked={mode === option.value} onChange={() => setMode(option.value)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" />
              <span>
                <span className="block text-[0.875rem] font-[600]">{option.label}</span>
                <span className="block text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      reason={{ label: `Reason · ${name} sees it`, choices: REASON_CHOICES.damageVoid }}
      confirmLabel="Send back"
      busy={busy}
      error={error ? `It was not recorded: ${sensitiveVerificationText(error)}` : null}
      onClose={() => !busy && onClose()}
      onConfirm={async ({ reason, credentials }) => {
        if (!reason) return;
        await onConfirm(mode, reason, credentials);
      }}
    />
  );
}

type OrdinaryCopy = { title: string; description: string; confirm: string };

export function ordinaryCopy(key: DecisionKey, input: { clientName: string | null; caseCount: number; transports: DamageReleaseTransport[] }): OrdinaryCopy {
  const client = input.clientName ?? "the client";
  const cases = `its ${input.caseCount} case${input.caseCount === 1 ? "" : "s"}`;
  const words = input.transports.map((transport) => (transport === "INBOX" ? "an inbox message" : transport === "EMAIL" ? "an email" : "an SMS"));
  const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
  switch (key) {
    case "release":
      return {
        title: `Release to ${client}?`,
        description: `They see the report and ${cases} in their portal${list ? `, and get ${list}` : ""}. ${list ? "" : "No message is sent. "}You can take it back.`,
        confirm: "Release",
      };
    case "take-back":
      return { title: "Take the report back from the client?", description: "It and its cases disappear from their portal. A message already sent cannot be unsent.", confirm: "Take back" };
    case "close":
      return { title: "Close without releasing?", description: "The report stays on the property's history and is never shown to the client. You can reopen it.", confirm: "Close without releasing" };
    case "close-released":
      return { title: "Close this report?", description: "It stays in the client's portal and on the property's history. You can reopen it.", confirm: "Close report" };
    case "reopen":
      return { title: "Reopen for review?", description: "It goes back under review. Whether the client can see it does not change.", confirm: "Reopen" };
    default:
      return { title: "", description: "", confirm: "" };
  }
}

export function OrdinaryDecisionDialog({
  decision,
  copy,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  decision: DecisionKey | null;
  copy: OrdinaryCopy | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <EConfirmDialog
      open={Boolean(decision && copy)}
      tier="ordinary"
      title={copy?.title ?? ""}
      description={copy?.description}
      confirmLabel={copy?.confirm ?? "Confirm"}
      busy={busy}
      error={error ? `It was not recorded: ${error}` : null}
      onClose={() => !busy && onClose()}
      onConfirm={onConfirm}
    />
  );
}

type PreviewState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; report: RecordReport };

export function ClientPreviewDialog({ reportId, open, onClose }: { reportId: string; open: boolean; onClose: () => void }) {
  const [state, setState] = React.useState<PreviewState>({ status: "loading" });
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    readClientPreview(reportId, controller.signal)
      .then((report) => {
        if (controller.signal.aborted || report.id !== reportId) return;
        setState({ status: "ready", report });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: error instanceof Error ? error.message : "The client preview could not be loaded." });
      });
    return () => controller.abort();
  }, [open, reportId]);
  if (!open) return null;
  return (
    <EActionDialog open wide onClose={onClose} title="What the client will see" eyebrow="Preview as the client · read only">
      <p className="mb-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        Rendered from the client view: no estimates, internal notes, reviewer or send-back history. Nothing here is sent; the client sees it only once it is released.
      </p>
      {state.status === "loading" ? <p role="status" className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Loading the client&rsquo;s view…</p> : null}
      {state.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{state.message}</p> : null}
      {state.status === "ready" ? (
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
          <DamageInvestigation reportId={reportId} audience="CLIENT" previewReport={state.report} />
        </div>
      ) : null}
    </EActionDialog>
  );
}
