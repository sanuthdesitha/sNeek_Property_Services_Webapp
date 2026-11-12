"use client";

/**
 * Every status action the old board had, offered only where the transition
 * table allows it: offer return, set status, record the final decision
 * (Returned / Donated / Disposed / Unclaimed, with a note), archive — and, for
 * a closed item, an explicit Reopen that needs a reason and keeps the previous
 * decision on the timeline.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { HydratedLostFoundItem } from "@/lib/lost-found/service";
import { isOpenStatus, isResolvedStatus, lostFoundStatusLabel, type LostFoundStatus } from "@/lib/lost-found/status";
import { lostFoundTransitionOptions } from "@/lib/lost-found/transitions";
import { formatDateTime } from "./lost-found-format";

type Save = (payload: Record<string, unknown>, success: string) => Promise<boolean>;
type Post = (payload: Record<string, unknown>, success: string) => Promise<boolean>;

const DECISION_LABEL: Record<string, string> = { RETURNED: "Returned to guest", DONATED: "Donated", DISPOSED: "Disposed", UNCLAIMED: "Unclaimed" };
const DECISIONS: LostFoundStatus[] = ["RETURNED", "DONATED", "DISPOSED", "UNCLAIMED"];

function DecisionForm({ status, save, onDone }: { status: LostFoundStatus; save: Save; onDone: () => void }) {
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function confirm() {
    setSaving(true);
    const ok = await save({ status, resolution: note.trim() || null }, `Marked ${DECISION_LABEL[status]}`);
    setSaving(false);
    if (ok) onDone();
  }
  return (
    <fieldset disabled={saving} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <p className="text-[0.8125rem]">Recording <span className="font-[600]">{DECISION_LABEL[status]}</span> as the final decision.</p>
      <EField label="Resolution note (optional)">
        <ETextarea value={note} maxLength={4000} onChange={(event) => setNote(event.target.value)} placeholder="e.g. couriered to guest, held 14 days" />
      </EField>
      <div className="flex justify-end gap-2">
        <EButton size="sm" variant="outline" onClick={onDone}>Cancel</EButton>
        <EButton size="sm" variant="gold" onClick={() => void confirm()}>{saving ? "Saving…" : `Confirm ${DECISION_LABEL[status]}`}</EButton>
      </div>
    </fieldset>
  );
}

function ReopenForm({ save }: { save: Save }) {
  const [target, setTarget] = React.useState<LostFoundStatus>("IN_STORAGE");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const ok = await save({ status: target, reopenReason: reason.trim() }, "Item reopened");
    setSaving(false);
    if (ok) setReason("");
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="space-y-2">
        <EField label="Reopen to">
          <ESelect value={target} onChange={(event) => setTarget(event.target.value as LostFoundStatus)}>
            {(["REPORTED", "IN_STORAGE", "GUEST_CONTACTED", "RETURN_OFFERED"] as LostFoundStatus[]).map((status) => <option key={status} value={status}>{lostFoundStatusLabel(status)}</option>)}
          </ESelect>
        </EField>
        <EField label="Why reopen?" hint="Required. The previous decision stays on the timeline.">
          <ETextarea required value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} />
        </EField>
        <div className="flex justify-end"><EButton type="submit" size="sm" variant="outline" disabled={!reason.trim()}>{saving ? "Reopening…" : "Reopen item"}</EButton></div>
      </fieldset>
    </form>
  );
}

export function ItemDecisions({ item, timeZone, save, post }: { item: HydratedLostFoundItem; timeZone: string; save: Save; post: Post }) {
  const status = item.status as LostFoundStatus;
  const options = lostFoundTransitionOptions(status);
  const direct = options.filter((option) => option.kind === "direct").map((option) => option.status);
  const setTargets = direct.filter((target) => !isResolvedStatus(target));
  const decisions = DECISIONS.filter((target) => direct.includes(target));
  const [statusDraft, setStatusDraft] = React.useState<LostFoundStatus | "">(setTargets[0] ?? "");
  const [deciding, setDeciding] = React.useState<LostFoundStatus | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => setStatusDraft(setTargets[0] ?? ""), [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(task: () => Promise<boolean>) {
    setBusy(true);
    await task();
    setBusy(false);
  }

  return (
    <section aria-label="Status and decision" className="space-y-3">
      <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">Status and decision</h3>
      {item.resolvedAt ? (
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.8125rem]">
          <p className="font-[550]">{lostFoundStatusLabel(item.status)} · {formatDateTime(item.resolvedAt, timeZone)}{item.resolvedByName ? ` by ${item.resolvedByName}` : ""}</p>
          {item.resolution ? <p className="mt-1 whitespace-pre-wrap text-[hsl(var(--e-muted-foreground))]">{item.resolution}</p> : null}
        </div>
      ) : null}
      {isOpenStatus(status) || direct.length ? (
        <fieldset disabled={busy} className="space-y-3">
          {direct.includes("RETURN_OFFERED") ? (
            <EButton size="sm" variant="outline" onClick={() => void run(() => post({ action: "OFFER_RETURN" }, "Return offered"))}>Offer return</EButton>
          ) : null}
          {setTargets.length ? (
            <div className="flex flex-wrap items-end gap-2">
              <EField label="Set status" className="min-w-[10rem] flex-1">
                <ESelect value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as LostFoundStatus)}>
                  {setTargets.map((target) => <option key={target} value={target}>{lostFoundStatusLabel(target)}</option>)}
                </ESelect>
              </EField>
              <EButton size="sm" disabled={!statusDraft} onClick={() => void run(() => save({ status: statusDraft }, "Status updated"))}>Update status</EButton>
            </div>
          ) : null}
          {deciding ? (
            <DecisionForm status={deciding} save={save} onDone={() => setDeciding(null)} />
          ) : decisions.length ? (
            <div className="grid grid-cols-2 gap-2">
              {decisions.map((target) => (
                <EButton key={target} size="sm" variant="outline" onClick={() => setDeciding(target)}>{DECISION_LABEL[target]}</EButton>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}
      {!isOpenStatus(status) ? <ReopenForm save={save} /> : null}
    </section>
  );
}
