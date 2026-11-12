"use client";

import { KeyRound, Image as ImageIcon } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EAccessInfo } from "@/components/v2/shared/access-info";
import { entriesForAudience, sanitizeAccessGuide } from "@/lib/properties/access-guide";
import type { ActionTask, LaundryAction, LaundryPortalConfig } from "./laundry-action-modal";

type Task = Omit<ActionTask, "property"> & { property?: (ActionTask["property"] & { accessInfo?: unknown; accessGuide?: unknown; address?: string | null }) | null };

export function NextStopExecution({ task, kind, config, onAction }: {
  task?: Task; kind: "pickup" | "dropoff"; config?: LaundryPortalConfig;
  onAction: (taskId: string, action: LaundryAction) => void;
}) {
  if (!task) return <p role="status">Stop details unavailable. Refresh before continuing.</p>;
  const confirmations = [...(task.confirmations ?? [])].reverse();
  const pickup = confirmations.map(row => { try { return JSON.parse(row.notes ?? "null"); } catch { return null; } }).find(row => row?.event === "PICKED_UP");
  const bags = Number.isInteger(pickup?.bagCount) && pickup.bagCount > 0 ? pickup.bagCount : null;
  const location = confirmations.find(row => row.bagLocation?.trim())?.bagLocation;
  const action = kind === "pickup" && ["PENDING", "CONFIRMED"].includes(task.status) ? "PICKED_UP" : kind === "dropoff" && task.status === "PICKED_UP" ? "RETURNED" : null;
  return <div className="min-w-0 space-y-3 break-words [overflow-wrap:anywhere] border-t border-[hsl(var(--e-border))] pt-3 text-sm">
    {task.property?.address ? <p>{task.property.address}</p> : null}
    <p>{bags == null ? (kind === "pickup" ? "Bag count not recorded; count bags at pickup." : "Bag count not recorded; check the task history before returning bags.") : `${bags} bags recorded at pickup.`}</p>
    {location ? <p>Recorded bag location: {location}</p> : null}
    <PropertyAccessDetails property={task.property} />
    <p>{!config ? "Proof settings unavailable. Reload the page to reload settings." : kind === "pickup" ? `Count bags and confirm pickup.${config.showPickupPhoto ? " Pickup photo is optional." : ""}` : `Record drop-off location and confirm return.${config.requireDropoffPhoto ? " Drop-off photo required." : ""}${config.requireEarlyDropoffReason ? " Early returns require a reason." : ""}`}</p>
    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
    {action ? <EButton onClick={() => onAction(task.id, action)}>{action === "PICKED_UP" ? "Confirm pickup" : "Confirm drop-off"}</EButton> : <p role="status">{task.status === "FLAGGED" ? "This task is flagged. Review it on the task board before continuing." : kind === "dropoff" ? "Pickup must be recorded before confirming drop-off." : "Review this task's current status on the task board."}</p>}
    {action === "PICKED_UP" ? <EButton variant="outline" onClick={() => onAction(task.id, "FAILED_PICKUP")}>Report access problem</EButton> : null}
    <a className="inline-flex min-h-11 items-center underline" href={`/v2/laundry/tracking#task-${encodeURIComponent(task.id)}`}>Open task board</a>
    </div>
  </div>;
}

/**
 * The property's access steps for the laundry audience (the server has
 * already applied the audience rule) and the legacy access notes. Shared by
 * the next-stop card and the laundry stop screen.
 */
export function PropertyAccessDetails({ property, defaultOpen = false }: { property?: { accessInfo?: unknown; accessGuide?: unknown } | null; defaultOpen?: boolean }) {
  const info = property?.accessInfo;
  const access = info && typeof info === "object" && !Array.isArray(info) ? info as Record<string, unknown> : {};
  const guide = entriesForAudience(sanitizeAccessGuide(property?.accessGuide), "LAUNDRY");
  const hasLegacyAccess = ["instructions", "lockbox", "codes", "parking", "other"].some((key) => Boolean(access[key]))
    || (Array.isArray(access.sections) && access.sections.length > 0);
  const task = { property };
  return (
    <details open={defaultOpen} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-[0.875rem] font-[600] [&::-webkit-details-marker]:hidden">
        <KeyRound className="h-4 w-4 shrink-0 text-[hsl(var(--e-accent-portal))]" aria-hidden />
        <span className="flex-1">Property access</span>
        <span className="text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
          {guide.length ? `${guide.length} step${guide.length === 1 ? "" : "s"}` : "Notes"}
        </span>
      </summary>
      <div className="space-y-3 border-t border-[hsl(var(--e-border))] p-3">
        {guide.map((entry) => (
          <div key={entry.id} className="rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-3">
            <p className="text-[0.875rem] font-[600]">{entry.label}</p>
            {entry.level || entry.locationNote ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {[entry.level ? `Level ${entry.level}` : null, entry.locationNote].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            {entry.instructions ? <p className="mt-1 whitespace-pre-wrap text-[0.8125rem]">{entry.instructions}</p> : null}
            {entry.images.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {entry.images.map((image) => (
                  <a
                    key={image.key}
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-2.5 text-[0.75rem] font-[550]"
                  >
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                    {image.caption || "Access photo"}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {/* The same lockbox, codes and parking notes the cleaner sees. */}
        <EAccessInfo accessInfo={task.property?.accessInfo} defaultOpen />
        {guide.length === 0 && !hasLegacyAccess ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No access details are recorded for this property. Contact the office before you travel.
          </p>
        ) : null}
      </div>
    </details>
  );
}
