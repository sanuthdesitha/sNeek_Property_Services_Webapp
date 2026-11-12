"use client";

/**
 * The item side panel (`?open=<id>`), as drawn: title, stage bar, photos with
 * the lightbox, found / by / job (a link), the guest card, Next step (Message
 * guest, Tell client, Move to storage), Stored at and Est. value, every status
 * action, and the timeline with comments. Keyed by item id by its parent, so
 * nothing typed for one item ever shows on another; a late answer for a
 * previous item is ignored.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { EField, EInput } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import { holdingState, NEW_ITEM_FLAG_DAYS, unprocessedNewFlag } from "@/lib/lost-found/holding";
import type { MessageAudience, MessageDraft } from "@/lib/lost-found/message";
import type { HydratedLostFoundItem } from "@/lib/lost-found/service";
import { formatDateTime, lostFoundStages, visitedStatuses } from "./lost-found-format";
import { LostFoundLightbox, LostFoundThumb } from "./lost-found-photo";
import { ItemGuestCard } from "./item-guest-card";
import { ItemDecisions } from "./item-decisions";
import { ItemMessageDialog, type MessageDrafts } from "./item-message-dialog";
import { ItemTimeline } from "./item-timeline";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; item: HydratedLostFoundItem };

const dt = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

async function send(url: string, method: "PATCH" | "POST", payload: Record<string, unknown>): Promise<HydratedLostFoundItem> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = (await response.json().catch(() => null)) as (HydratedLostFoundItem & { error?: string }) | null;
  if (!response.ok || !body?.id) throw new Error(body?.error ?? `The change was not saved (${response.status}).`);
  return body;
}

function StorageFields({ item, save }: { item: HydratedLostFoundItem; save: (payload: Record<string, unknown>, success: string) => Promise<boolean> }) {
  const [stored, setStored] = React.useState(item.storageLocation ?? "");
  const [value, setValue] = React.useState(item.estimatedValue === null ? "" : String(item.estimatedValue));
  const [saving, setSaving] = React.useState(false);
  const [invalid, setInvalid] = React.useState(false);
  const dirty = stored !== (item.storageLocation ?? "") || value !== (item.estimatedValue === null ? "" : String(item.estimatedValue));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const amount = value.trim() === "" ? null : Number(value);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setSaving(true);
    await save({ storageLocation: stored.trim() || null, estimatedValue: amount }, "Saved");
    setSaving(false);
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={saving} className="flex flex-wrap items-end gap-2">
        <EField label="Stored at" className="min-w-[10rem] flex-1"><EInput value={stored} maxLength={200} placeholder="Shelf or location" onChange={(event) => setStored(event.target.value)} /></EField>
        <EField label="Est. value" className="w-[120px]"><EInput inputMode="decimal" value={value} placeholder="$" onChange={(event) => setValue(event.target.value)} className="e-tnum" /></EField>
        <EButton type="submit" size="sm" variant="outline" disabled={!dirty}>{saving ? "Saving…" : "Save"}</EButton>
      </fieldset>
      {invalid ? <p role="alert" className="mt-1 text-[0.75rem] text-[hsl(var(--e-danger))]">Enter the value as a number of dollars, or leave it blank.</p> : null}
    </form>
  );
}

export function ItemPanel({ itemId, timeZone, holdingDays, onClose, onChanged }: { itemId: string; timeZone: string; holdingDays: number; onClose: () => void; onChanged: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [lightbox, setLightbox] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<MessageAudience | null>(null);
  const [drafts, setDrafts] = React.useState<MessageDrafts>({});
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/lost-found/${itemId}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (HydratedLostFoundItem & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.id) throw new Error(body?.error ?? "Could not load this item.");
        setLoad({ status: "ready", item: body });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load this item." });
      });
    return () => controller.abort();
  }, [itemId]);

  const apply = React.useCallback(async (task: () => Promise<HydratedLostFoundItem>, success: string) => {
    setActionError(null);
    try {
      const item = await task();
      setLoad({ status: "ready", item });
      toast({ title: success });
      onChanged();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The change was not saved.");
      return false;
    }
  }, [onChanged]);
  const save = React.useCallback((payload: Record<string, unknown>, success: string) => apply(() => send(`/api/lost-found/${itemId}`, "PATCH", payload), success), [apply, itemId]);
  const post = React.useCallback((payload: Record<string, unknown>, success: string) => apply(() => send(`/api/lost-found/${itemId}/events`, "POST", payload), success), [apply, itemId]);
  const onSent = React.useCallback((sent: HydratedLostFoundItem) => {
    setLoad({ status: "ready", item: sent });
    onChanged();
  }, [onChanged]);
  const onDraftChange = React.useCallback((audience: MessageAudience, draft: MessageDraft) => setDrafts((current) => ({ ...current, [audience]: draft })), []);

  const item = load.status === "ready" ? load.item : null;
  const holding = item ? holdingState({ status: item.status, foundAt: new Date(item.createdAt), now: new Date(), timeZone, holdingDays }) : null;
  const unprocessed = item ? unprocessedNewFlag({ status: item.status, foundAt: new Date(item.createdAt), now: new Date(), timeZone }) : null;

  return (
    <ESidePanel open title={item?.itemName ?? (load.status === "error" ? "Item unavailable" : "Loading…")} label="Item detail" onClose={onClose} className="lg:w-[440px]">
      {load.status === "loading" ? <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading the item…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {item && holding ? (
        <>
          <EStageBar label="Item stages" stages={lostFoundStages(item.status, visitedStatuses(item.events))} />
          {holding.counts ? (
            <p className={holding.past ? "rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-1.5 text-[0.8125rem] text-[hsl(var(--e-warning))]" : dt}>
              Held {holding.days} {holding.days === 1 ? "day" : "days"}{holding.past ? ` · past the ${holdingDays}-day holding period` : ` of ${holdingDays}`}
            </p>
          ) : null}
          {unprocessed ? (
            <p className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-1.5 text-[0.8125rem] text-[hsl(var(--e-warning))]">
              Still new {unprocessed.days} days after it was found (flagged after {NEW_ITEM_FLAG_DAYS}). Move it to storage or contact the guest.
            </p>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {item.photos.map((photo) => <LostFoundThumb key={photo.key} photo={photo} alt={item.itemName} className="h-[84px] w-[84px]" onOpen={setLightbox} />)}
            <dl className="grid min-w-0 flex-1 grid-cols-[70px_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
              <dt className={dt}>Found</dt>
              <dd className="min-w-0 break-words">{formatDateTime(item.createdAt, timeZone)}{item.foundLocation ? `, ${item.foundLocation}` : ""}</dd>
              <dt className={dt}>By</dt>
              <dd>{item.reportedByName ?? "Not recorded"}</dd>
              <dt className={dt}>Job</dt>
              <dd className="min-w-0 break-words">{item.jobId ? <Link className="underline" href={`/v2/admin/jobs/${item.jobId}`}>{[item.jobNumber, item.propertyName].filter(Boolean).join(" · ") || "Open job"}</Link> : "No job linked"}</dd>
              {!item.jobId ? (<><dt className={dt}>Property</dt><dd>{item.propertyName ?? "Not recorded"}</dd></>) : null}
            </dl>
          </div>
          {item.description ? <p className="whitespace-pre-wrap text-[0.8125rem]">{item.description}</p> : null}
          <ItemGuestCard key={`${item.id}:${item.guestSource}:${item.reservationId}:${item.guestName}:${item.guestContact}:${item.guestEmail}`} item={item} timeZone={timeZone} save={save} />
          <section aria-label="Next step" className="space-y-2">
            <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">Next step</h3>
            <div className="flex flex-wrap gap-2">
              <EButton size="sm" onClick={() => setMessage("guest")}>Message guest</EButton>
              <EButton size="sm" variant="outline" onClick={() => setMessage("client")}>Tell client</EButton>
              {item.status === "REPORTED" ? <EButton size="sm" variant="outline" onClick={() => void save({ status: "IN_STORAGE" }, "Moved to storage")}>Move to storage</EButton> : null}
            </div>
            <p className={dt}>&ldquo;Message guest&rdquo; opens a ready message with the item and return options. Sending it (accepted by the provider) or recording that you sent it moves the item to Guest contacted.</p>
          </section>
          {actionError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{actionError}</p> : null}
          <hr className="border-[hsl(var(--e-border))]" />
          <StorageFields key={`${item.id}:${item.storageLocation}:${item.estimatedValue}`} item={item} save={save} />
          <ItemDecisions key={item.id} item={item} timeZone={timeZone} save={save} post={post} />
          <ItemTimeline item={item} timeZone={timeZone} post={post} />
          <ItemMessageDialog itemId={item.id} audience={message} onClose={() => setMessage(null)} drafts={drafts} onDraftChange={onDraftChange} record={post} onSent={onSent} />
          <LostFoundLightbox url={lightbox} onClose={() => setLightbox(null)} />
        </>
      ) : null}
    </ESidePanel>
  );
}
