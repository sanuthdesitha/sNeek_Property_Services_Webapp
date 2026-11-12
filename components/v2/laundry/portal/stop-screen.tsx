"use client";

/**
 * The laundry stop screen (board 2 "Stop"): what the cleaner reported (bags,
 * where, photo), property access, then the answers for this leg. Pickup uses
 * the drawn inline form (./stop-pickup-form.tsx); drop-off opens the existing
 * drop-off dialog with all its fields (location, photo, weight, price,
 * receipt, early reason). "Pickup failed" and "Report access problem" open the
 * existing failed-pickup path (reschedule or ask the office to skip/delete).
 * Signal is shown honestly: answers kept on this phone are not sent.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { useLaundryActionModal, type ActionTask } from "@/components/v2/laundry/laundry-action-modal";
import { PropertyAccessDetails } from "@/components/v2/laundry/next-stop-execution";
import { StopPickupForm } from "./stop-pickup-form";
import { PartnerRunEntries, type PartnerEntryTask } from "./partner-run-entries";
import { useStopDraft } from "./use-stop-draft";

export type CleanerReport = { byName: string | null; atLabel: string | null; ready: boolean | null; bagCount: number | null; location: string | null; photoUrl: string | null };

export type StopScreenTask = ActionTask & {
  property?: (ActionTask["property"] & { accessInfo?: unknown; accessGuide?: unknown; address?: string | null }) | null;
  bagWeightKg?: number | null;
  dropoffCostAud?: number | null;
};

type Props = {
  task: StopScreenTask;
  kind: "PICKUP" | "DROP";
  viewerId: string;
  stopLabel: string;
  cleaner: CleanerReport | null;
  expected: number | null;
  baselineId: string | null;
  officePhone: string | null;
  /** A LAUNDRY login acting as themselves: may add weight / price, ready to return, drop-off photos. */
  partnerEntries?: boolean;
};

function useOnline(): boolean {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

function CleanerCard({ cleaner }: { cleaner: CleanerReport | null }) {
  return (
    <ECard className="p-3">
      <div className="flex items-center justify-between gap-2">
        <b className="text-[0.875rem] font-[600]">Cleaner says</b>
        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{cleaner ? [cleaner.byName, cleaner.atLabel].filter(Boolean).join(" · ") : ""}</span>
      </div>
      {cleaner ? (
        <div className="mt-1.5 flex items-start gap-2.5">
          {cleaner.photoUrl ? <MediaGallery items={[{ id: "cleaner-photo", url: cleaner.photoUrl, label: "Cleaner's photo" }]} title="Cleaner's photo" className="w-16 shrink-0" /> : null}
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {[cleaner.ready === true ? "Ready" : cleaner.ready === false ? "Not ready" : "Ready not confirmed", cleaner.bagCount ? `${cleaner.bagCount} bag${cleaner.bagCount === 1 ? "" : "s"}` : "bag count not given", cleaner.location].filter(Boolean).join(" · ")}
          </p>
        </div>
      ) : <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">The cleaner has not reported the bags for this run.</p>}
    </ECard>
  );
}

export function StopScreen({ task, kind, viewerId, stopLabel, cleaner, expected, baselineId, officePhone, partnerEntries = false }: Props) {
  const router = useRouter();
  const online = useOnline();
  const draftState = useStopDraft(`laundry-stop:${viewerId}:${task.id}:${kind}`, expected ?? 1);
  const done = () => {
    toast({ title: kind === "PICKUP" ? "Pickup recorded" : "Drop-off recorded" });
    router.push("/v2/laundry");
    router.refresh();
  };
  const { openAction, modal } = useLaundryActionModal(done);
  const canPickup = kind === "PICKUP" && ["PENDING", "CONFIRMED"].includes(task.status);
  // A drop is recorded from picked up or "Ready to return" (marking ready is optional).
  const canDrop = kind === "DROP" && (task.status === "PICKED_UP" || task.status === "READY_TO_RETURN");
  const entryTask: PartnerEntryTask = { id: task.id, status: task.status, updatedAt: task.updatedAt, bagWeightKg: task.bagWeightKg, dropoffCostAud: task.dropoffCostAud, propertyName: task.property?.name ?? "Property" };
  const refresh = () => router.refresh();
  const name = task.property?.name ?? "Property";
  const hasDraft = draftState.restored || draftState.persisted === true;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <EButton asChild variant="outline" size="sm" className="h-11 w-11 shrink-0 p-0"><Link href="/v2/laundry" aria-label="Back to Today"><ChevronLeft className="h-5 w-5" /></Link></EButton>
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-[1.125rem] font-[600]">{kind === "PICKUP" ? "Pickup" : "Drop"} · {name}</h1>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{stopLabel}</p>
        </div>
        {officePhone ? <EButton asChild variant="outline" size="sm" className="h-11 w-11 shrink-0 p-0"><a href={`tel:${officePhone}`} aria-label="Call the office"><Phone className="h-5 w-5" /></a></EButton> : null}
      </div>
      {!online ? (
        <p role="status" className="rounded-[10px] bg-[hsl(var(--e-warning)/0.12)] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-warning))]">
          <b>No signal.</b> {hasDraft ? "Your answers are saved on this phone, not sent yet." : "Answers you enter stay on this phone until you send them."} The office sees the {kind === "PICKUP" ? "pickup" : "drop-off"} only once it sends. Photos upload when there is signal.
        </p>
      ) : hasDraft && kind === "PICKUP" ? (
        <p role="status" className="rounded-[10px] bg-[hsl(var(--e-surface-raised,var(--e-muted)))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Saved on this phone, not sent yet.</p>
      ) : null}
      <CleanerCard cleaner={cleaner} />
      <ECard className="p-3">
        <div className="flex items-center justify-between gap-2">
          <b className="text-[0.875rem] font-[600]">Property access</b>
          {canPickup ? <button type="button" className="min-h-11 text-[0.8125rem] text-[hsl(var(--e-primary))] underline" onClick={() => openAction(task, "FAILED_PICKUP")}>Report access problem</button> : null}
        </div>
        {task.property?.address ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{task.property.address}</p> : null}
        <PropertyAccessDetails property={task.property} />
      </ECard>
      {canPickup ? (
        <StopPickupForm
          task={{ id: task.id, status: task.status, updatedAt: task.updatedAt, propertyName: name }}
          expected={expected}
          baselineId={baselineId}
          draftState={draftState}
          onDone={done}
          onFailedPickup={() => openAction(task, "FAILED_PICKUP")}
        />
      ) : canDrop ? (
        <div className="space-y-2">
          {task.status === "READY_TO_RETURN" ? <p role="status" className="text-[0.8125rem] font-[600]">Ready to return</p> : null}
          {partnerEntries ? <PartnerRunEntries key={task.id} task={entryTask} onSaved={refresh} /> : null}
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Record where the bags were left, the drop-off photo and, if you have them, weight, price and receipt.</p>
          <EButton className="min-h-12 w-full justify-center" onClick={() => openAction(task, "RETURNED")}>Confirm drop-off</EButton>
        </div>
      ) : kind === "DROP" && task.status === "DROPPED" && partnerEntries ? (
        <div className="space-y-2">
          <p role="status" className="text-[0.875rem]">This drop-off is recorded. <Link className="underline" href={`/v2/laundry/tracking#task-${encodeURIComponent(task.id)}`}>Open on Tracking</Link></p>
          <PartnerRunEntries key={task.id} task={entryTask} onSaved={refresh} />
        </div>
      ) : (
        <p role="status" className="text-[0.875rem]">
          {task.status === "FLAGGED" ? "This run is flagged for the office. Check it on Tracking before continuing." : kind === "DROP" && ["PENDING", "CONFIRMED"].includes(task.status) ? "The pickup must be recorded before the drop-off." : "This stop is done."}{" "}
          <Link className="underline" href={`/v2/laundry/tracking#task-${encodeURIComponent(task.id)}`}>Open on Tracking</Link>
        </p>
      )}
      {modal}
    </div>
  );
}
