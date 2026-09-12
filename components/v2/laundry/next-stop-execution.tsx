"use client";

import { EButton } from "@/components/v2/ui/primitives";
import { entriesForAudience, sanitizeAccessGuide } from "@/lib/properties/access-guide";
import type { ActionTask, LaundryAction, LaundryPortalConfig } from "./laundry-action-modal";

type Task = Omit<ActionTask, "property"> & { property?: (ActionTask["property"] & { accessInfo?: unknown; accessGuide?: unknown; address?: string | null }) | null };

export function NextStopExecution({ task, kind, config, onAction }: {
  task?: Task; kind: "pickup" | "dropoff"; config?: LaundryPortalConfig;
  onAction: (taskId: string, action: LaundryAction) => void;
}) {
  if (!task) return <p role="status">Stop details unavailable. Refresh before continuing.</p>;
  const info = task.property?.accessInfo;
  const access = info && typeof info === "object" && !Array.isArray(info) ? info as Record<string, unknown> : {};
  const guide = entriesForAudience(sanitizeAccessGuide(task.property?.accessGuide), "LAUNDRY", access.laundrySameAsCleaner === true);
  const confirmations = [...(task.confirmations ?? [])].reverse();
  const pickup = confirmations.map(row => { try { return JSON.parse(row.notes ?? "null"); } catch { return null; } }).find(row => row?.event === "PICKED_UP");
  const bags = Number.isInteger(pickup?.bagCount) && pickup.bagCount > 0 ? pickup.bagCount : null;
  const location = confirmations.find(row => row.bagLocation?.trim())?.bagLocation;
  const action = kind === "pickup" && ["PENDING", "CONFIRMED"].includes(task.status) ? "PICKED_UP" : kind === "dropoff" && task.status === "PICKED_UP" ? "RETURNED" : null;
  return <div className="space-y-3 border-t border-[hsl(var(--e-border))] pt-3 text-sm">
    {task.property?.address ? <p>{task.property.address}</p> : null}
    <p>{bags == null ? (kind === "pickup" ? "Bag count not recorded; count bags at pickup." : "Bag count not recorded; check the task history before returning bags.") : `${bags} bags recorded at pickup.`}</p>
    {location ? <p>Recorded bag location: {location}</p> : null}
    <details><summary className="cursor-pointer font-semibold">Laundry access guide</summary>
      {guide.length ? <div className="space-y-3 py-2">{guide.map(entry => <div key={entry.id}>
        <p className="font-medium">{entry.label}</p>
        {entry.level ? <p>Level: {entry.level}</p> : null}
        {entry.locationNote ? <p>{entry.locationNote}</p> : null}
        {entry.instructions ? <p className="whitespace-pre-wrap">{entry.instructions}</p> : null}
        {entry.images.map(image => <a className="mr-3 underline" key={image.key} href={image.url} target="_blank" rel="noreferrer">{image.caption || "View access photo"}</a>)}
      </div>)}</div> : <p>No structured laundry access guide recorded. Check the task board for existing access notes.</p>}
    </details>
    <p>{!config ? "Proof settings unavailable. Reload the page to reload settings." : kind === "pickup" ? `Count bags and confirm pickup.${config.showPickupPhoto ? " Pickup photo is optional." : ""}` : `Record drop-off location and confirm return.${config.requireDropoffPhoto ? " Drop-off photo required." : ""}${config.requireEarlyDropoffReason ? " Early returns require a reason." : ""}`}</p>
    {action ? <EButton onClick={() => onAction(task.id, action)}>{action === "PICKED_UP" ? "Confirm pickup" : "Confirm drop-off"}</EButton> : <p role="status">{task.status === "FLAGGED" ? "This task is flagged. Review it on the task board before continuing." : kind === "dropoff" ? "Pickup must be recorded before confirming drop-off." : "Review this task's current status on the task board."}</p>}
    <a className="ml-3 underline" href={`/v2/laundry/tracking#task-${encodeURIComponent(task.id)}`}>Open task board</a>
  </div>;
}
