"use client";

/**
 * Action forms of the QA issue detail. Same actions and validation as the old
 * QA issues workspace; each submits through patchIssue. Fields freeze while a
 * save runs, and a failed save keeps what was typed.
 */
import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { LabeledField } from "../hub/labeled-field";
import type { QualityIssueRow } from "@/lib/quality/issue-rows";
import { RECTIFICATION_STATUSES, titleCaseKey } from "@/lib/quality/types";
import { keyList } from "./issue-format";
import { PhotoPicker, uploadRectificationPhoto, type PickedPhoto } from "./issue-evidence";
import { patchIssue, type IssueActionBody } from "./issue-requests";

export type IssueActionKey = "rectify" | "deduction" | "escalate";

const PANEL = "space-y-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] p-3";

export function IssueActions({
  issue,
  initialAction,
  falseConfirmationDeduction,
  onChanged,
}: {
  issue: QualityIssueRow;
  initialAction: IssueActionKey | null;
  /** settings.accountability.scoring.falseConfirmationExtraDeduction, or null when unknown. */
  falseConfirmationDeduction: number | null;
  onChanged: () => void | Promise<void>;
}) {
  const [action, setAction] = React.useState<IssueActionKey | null>(initialAction);
  const [busy, setBusy] = React.useState(false);
  // Starts on the issue's current status, as the old drawer did: choosing who
  // fixed it is deliberate, because it decides who is paid.
  const [rectStatus, setRectStatus] = React.useState<string>(issue.rectificationStatus || "FIXED_BY_QA");
  const [rectMinutes, setRectMinutes] = React.useState("");
  const [rectBefore, setRectBefore] = React.useState<PickedPhoto[]>([]);
  const [rectAfter, setRectAfter] = React.useState<PickedPhoto[]>([]);
  const [uploadingSide, setUploadingSide] = React.useState<null | "before" | "after">(null);
  const [dedAmount, setDedAmount] = React.useState("");
  const [dedNote, setDedNote] = React.useState("");
  const [escReason, setEscReason] = React.useState("");

  const savedBefore = React.useMemo(() => keyList(issue.rectificationBeforeKeys), [issue]);
  const savedAfter = React.useMemo(() => keyList(issue.rectificationAfterKeys), [issue]);

  async function submit(body: IssueActionBody, successMessage: string) {
    setBusy(true);
    const result = await patchIssue(issue.id, body);
    setBusy(false);
    if (!result.ok) {
      toast({ title: "Not saved", description: result.error, variant: "destructive" });
      return;
    }
    toast({ title: successMessage });
    await onChanged();
  }

  async function addPhotos(side: "before" | "after", files: FileList | null) {
    if (!files?.length) return;
    setUploadingSide(side);
    try {
      const uploaded: PickedPhoto[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadRectificationPhoto(file));
      (side === "before" ? setRectBefore : setRectAfter)((previous) => [...previous, ...uploaded]);
    } catch (cause) {
      toast({
        title: "Upload failed",
        description: cause instanceof Error ? cause.message : "Could not upload that photo.",
        variant: "destructive",
      });
    } finally {
      setUploadingSide(null);
    }
  }

  function saveRectification() {
    void submit(
      {
        action: "rectify",
        status: rectStatus,
        minutes: rectMinutes ? Number(rectMinutes) : undefined,
        // The endpoint REPLACES each side's key array, so saved keys are resent
        // with the new ones; a side with nothing new is not written at all.
        beforeKeys: rectBefore.length ? [...savedBefore, ...rectBefore.map((p) => p.key)] : undefined,
        afterKeys: rectAfter.length ? [...savedAfter, ...rectAfter.map((p) => p.key)] : undefined,
      },
      "Rectification updated",
    );
  }

  function proposeDeduction() {
    const amount = Number(dedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount greater than zero.", variant: "destructive" });
      return;
    }
    if (!dedNote.trim()) {
      toast({ title: "A note is required.", variant: "destructive" });
      return;
    }
    void submit({ action: "proposeDeduction", amount, note: dedNote.trim() }, "Deduction proposed — pending approval");
  }

  function escalate() {
    if (!escReason.trim()) {
      toast({ title: "A reason is required.", variant: "destructive" });
      return;
    }
    void submit({ action: "escalate", reason: escReason.trim() }, "Issue escalated");
  }

  const toggle = (key: IssueActionKey) => setAction((current) => (current === key ? null : key));
  const confirmLabel = falseConfirmationDeduction === null ? "Confirm" : `Confirm (−${falseConfirmationDeduction})`;

  return (
    <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-4">
      <EEyebrow>Actions</EEyebrow>
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" variant={action === "rectify" ? "gold" : "outline"} aria-pressed={action === "rectify"} disabled={busy} onClick={() => toggle("rectify")}>
          Mark rectification
        </EButton>
        <EButton size="sm" variant={action === "deduction" ? "gold" : "outline"} aria-pressed={action === "deduction"} disabled={busy} onClick={() => toggle("deduction")}>
          Propose deduction
        </EButton>
        <EButton size="sm" variant={action === "escalate" ? "gold" : "outline"} aria-pressed={action === "escalate"} disabled={busy} onClick={() => toggle("escalate")}>
          Escalate
        </EButton>
      </div>

      {issue.falseConfirmation === "SUSPECTED" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.08)] p-3">
          <ShieldAlert aria-hidden className="h-4 w-4 text-[hsl(var(--e-warning))]" />
          <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Suspected false completion confirmation.</span>
          <EButton size="sm" variant="danger" disabled={busy} onClick={() => void submit({ action: "falseConfirmation", decision: "CONFIRMED" }, "False confirmation confirmed")}>
            {confirmLabel}
          </EButton>
          <EButton size="sm" variant="outline" disabled={busy} onClick={() => void submit({ action: "falseConfirmation", decision: "REJECTED" }, "False confirmation rejected")}>
            Reject
          </EButton>
        </div>
      ) : null}

      {action === "rectify" ? (
        <fieldset disabled={busy} className={PANEL}>
          <legend className="sr-only">Mark rectification</legend>
          <div className="flex flex-wrap items-end gap-2">
            <LabeledField label="Status" className="min-w-[200px] flex-1">
              <ESelect value={rectStatus} onChange={(event) => setRectStatus(event.target.value)}>
                {RECTIFICATION_STATUSES.map((status) => (
                  <option key={status} value={status}>{titleCaseKey(status)}</option>
                ))}
              </ESelect>
            </LabeledField>
            <LabeledField label="Minutes">
              <EInput type="number" min="0" className="w-28" value={rectMinutes} onChange={(event) => setRectMinutes(event.target.value)} />
            </LabeledField>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PhotoPicker
              label="Before rectification"
              items={rectBefore}
              uploading={uploadingSide === "before"}
              disabled={busy}
              onFiles={(files) => void addPhotos("before", files)}
              onRemove={(index) => setRectBefore((previous) => previous.filter((_, i) => i !== index))}
            />
            <PhotoPicker
              label="After rectification"
              items={rectAfter}
              uploading={uploadingSide === "after"}
              disabled={busy}
              onFiles={(files) => void addPhotos("after", files)}
              onRemove={(index) => setRectAfter((previous) => previous.filter((_, i) => i !== index))}
            />
          </div>
          <EButton size="sm" variant="gold" disabled={busy || uploadingSide !== null} onClick={saveRectification}>
            {busy ? "Saving…" : "Save rectification"}
          </EButton>
        </fieldset>
      ) : null}

      {action === "deduction" ? (
        <fieldset disabled={busy} className={PANEL}>
          <legend className="sr-only">Propose deduction</legend>
          <div className="flex flex-wrap items-end gap-2">
            <LabeledField label="Amount ($)">
              <EInput type="number" min="0" step="0.01" className="w-32" value={dedAmount} onChange={(event) => setDedAmount(event.target.value)} />
            </LabeledField>
            <LabeledField label="Note" className="min-w-[220px] flex-1">
              <EInput value={dedNote} onChange={(event) => setDedNote(event.target.value)} placeholder="Reason for the deduction" />
            </LabeledField>
          </div>
          <EButton size="sm" variant="gold" disabled={busy} onClick={proposeDeduction}>
            {busy ? "Saving…" : "Propose deduction"}
          </EButton>
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            Creates a pending pay adjustment. Nothing is deducted until it is approved in Approvals.
          </p>
        </fieldset>
      ) : null}

      {action === "escalate" ? (
        <fieldset disabled={busy} className={PANEL}>
          <legend className="sr-only">Escalate</legend>
          <LabeledField label="Escalation reason">
            <ETextarea rows={3} value={escReason} onChange={(event) => setEscReason(event.target.value)} placeholder="Why this is being escalated…" />
          </LabeledField>
          <EButton size="sm" variant="gold" disabled={busy} onClick={escalate}>
            {busy ? "Saving…" : "Escalate issue"}
          </EButton>
        </fieldset>
      ) : null}
    </div>
  );
}
