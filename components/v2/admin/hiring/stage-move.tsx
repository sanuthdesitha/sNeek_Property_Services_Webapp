"use client";

/**
 * One stage move, from the board (drag or "Move to…") or the application page
 * (board "Hiring", 2026-11-16). Into Interview or Offer: the existing email
 * preview opens first with that stage's template, Send ("Move and send") or
 * "Move without email". Decline (Rejected): a reason pick, then the decline
 * email preview. New, Screening and Withdrawn have no stage email: a tier A
 * confirm. Hired is the account step, never a plain move. Nothing is sent by
 * the move itself.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { REASON_CHOICES } from "@/lib/confirmations/reasons";
import { stageEmailTemplate, stageLabel } from "@/lib/hiring/pipeline";
import { EmailPreviewModal } from "./application/email-preview-modal";

export type OfferDraft = { roleTitle: string; rate: string; startDate: string; accountRole: string };

export type PendingMove = {
  applicationId: string;
  name: string;
  from: string;
  to: string;
  offer?: OfferDraft | null;
};

type Step = { kind: "confirm" } | { kind: "reason" } | { kind: "email"; reason: string | null } | null;

export async function postStageMove(move: PendingMove, rejectionReason: string | null): Promise<string | null> {
  try {
    const res = await fetch(`/api/admin/workforce/hiring/applications/${encodeURIComponent(move.applicationId)}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: move.to, expectedFrom: move.from, offer: move.offer ?? undefined, rejectionReason: rejectionReason ?? undefined }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? "The move was not recorded.";
  } catch {
    return "The request did not reach the server.";
  }
}

export function StageMoveFlow({
  move,
  onFinished,
  onMessage,
}: {
  move: PendingMove | null;
  /** Called when the flow closes; `changed` is true when the stage moved. */
  onFinished: (changed: boolean) => void;
  onMessage: (text: string, tone: "success" | "danger") => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!move) return setStep(null);
    if (move.to === "HIRED") {
      router.push(`/v2/admin/hiring/applications/${encodeURIComponent(move.applicationId)}?hire=1`);
      onFinished(false);
      return;
    }
    if (move.to === "REJECTED") return setStep({ kind: "reason" });
    setStep(stageEmailTemplate(move.to) ? { kind: "email", reason: null } : { kind: "confirm" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new move starts a new flow
  }, [move]);

  if (!move || !step) return null;
  const target = stageLabel(move.to);

  if (step.kind === "confirm") {
    return (
      <EConfirmDialog
        open
        tier="ordinary"
        title={`Move ${move.name} to ${target}?`}
        description={`From ${stageLabel(move.from)}. This stage has no email; nothing is sent.`}
        confirmLabel={`Move to ${target}`}
        busy={busy}
        error={error}
        onClose={() => onFinished(false)}
        onConfirm={async () => {
          setBusy(true);
          const failure = await postStageMove(move, null);
          setBusy(false);
          if (failure) return setError(`It was not recorded: ${failure}`);
          onMessage(`${move.name} moved to ${target}.`, "success");
          onFinished(true);
        }}
      />
    );
  }

  if (step.kind === "reason") {
    return (
      <EConfirmDialog
        open
        tier="ordinary"
        title={`Decline ${move.name}?`}
        description="The reason stays on the application's history. The decline email opens next to check and send, or skip."
        reason={{ label: "Reason", choices: REASON_CHOICES.hiringDecline }}
        confirmLabel="Next: check the email"
        onClose={() => onFinished(false)}
        onConfirm={(result) => setStep({ kind: "email", reason: result.reason ?? null })}
      />
    );
  }

  return (
    <EmailPreviewModal
      applicationId={move.applicationId}
      open
      onClose={() => onFinished(false)}
      defaultTemplate={stageEmailTemplate(move.to) ?? "thank_you"}
      recipientName={move.name}
      onSent={() => onFinished(true)}
      onToast={(message) => onMessage(message.title, message.tone ?? "success")}
      move={{ targetLabel: target, run: () => postStageMove(move, step.reason) }}
    />
  );
}
