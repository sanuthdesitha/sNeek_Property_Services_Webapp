"use client";

/**
 * Every action on a maintenance item, shared by the list rows, the bulk bar,
 * the side panel and the item page, so they all behave the same way:
 *
 *  - Acknowledge, Mark in progress and Mark ordered apply at once and offer
 *    Undo for 10 seconds (Undo puts each item back to the status it had);
 *  - Mark resolved… and Dismiss… are ordinary confirms with one optional note;
 *  - Assign, Visit, Client price, Link to a job and Edit details open their
 *    sheet or dialog; Show to / Hide from the client is one edit;
 *  - Copy link copies the item page address.
 *
 * Nothing deletes an item: the API has no delete, so Dismiss is the way out.
 */
import * as React from "react";
import type { MaintenanceStatus } from "@prisma/client";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import { STATUS_LABELS } from "@/lib/maintenance/labels";
import { bulkStatus, patchMaintenanceItem, type StatusResult } from "./maintenance-api";
import { AssignSheet, type AssignDone, type AssignTarget } from "./assign-sheet";
import { VisitSheet, type VisitTarget } from "./visit-sheet";
import { EditDetailsDialog, LinkJobDialog, PriceDialog, StatusNoteDialog, type EditableItem, type LinkJobTarget, type PriceTarget, type StatusNoteRequest } from "./maintenance-dialogs";
import { readMaintenanceItem, type MaintenanceActionTarget, type MaintenanceDetailItem } from "./maintenance-types";

const QUICK_STATUSES: Array<{ status: MaintenanceStatus; label: string }> = [
  { status: "ACKNOWLEDGED", label: "Acknowledge" },
  { status: "IN_PROGRESS", label: "Mark in progress" },
  { status: "ORDERED", label: "Mark ordered" },
];

export const STATUS_ACTION_LABEL: Record<MaintenanceStatus, string> = {
  OPEN: "Reopen as Open",
  ACKNOWLEDGED: "Acknowledge",
  IN_PROGRESS: "Mark in progress",
  ORDERED: "Mark ordered",
  RESOLVED: "Mark resolved…",
  DISMISSED: "Dismiss…",
};

type StatusRequestState = StatusNoteRequest & { ids: string[] };

export type MaintenanceActionsOptions = {
  timeZone: string;
  isAdmin: boolean;
  /** After any successful change, with the ids it touched. */
  onChanged: (ids: string[]) => void;
  /** Bulk results that were not applied stay selected (list only). */
  onRefused?: (ids: string[]) => void;
};

function describeStatusResults(results: StatusResult[], status: MaintenanceStatus): string {
  const done = results.filter((result) => result.outcome === "done").length;
  const unchanged = results.filter((result) => result.outcome === "unchanged").length;
  const missing = results.filter((result) => result.outcome === "missing").length;
  const label = STATUS_LABELS[status].toLowerCase();
  const parts = [`${done} ${done === 1 ? "item" : "items"} marked ${label}`];
  if (unchanged) parts.push(`${unchanged} already ${label}`);
  if (missing) parts.push(`${missing} no longer found`);
  return parts.join(" · ");
}

export function useMaintenanceActions(options: MaintenanceActionsOptions) {
  const { timeZone, isAdmin } = options;
  const changedRef = React.useRef(options.onChanged);
  changedRef.current = options.onChanged;
  const refusedRef = React.useRef(options.onRefused);
  refusedRef.current = options.onRefused;

  const [statusRequest, setStatusRequest] = React.useState<StatusRequestState | null>(null);
  const [priceTarget, setPriceTarget] = React.useState<PriceTarget | null>(null);
  const [linkTarget, setLinkTarget] = React.useState<LinkJobTarget | null>(null);
  const [editItem, setEditItem] = React.useState<EditableItem | null>(null);
  const [assignTarget, setAssignTarget] = React.useState<AssignTarget | null>(null);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignSegment, setAssignSegment] = React.useState<"MAINTENANCE" | "CLEANER" | "QA">("MAINTENANCE");
  const [visitTarget, setVisitTarget] = React.useState<VisitTarget | null>(null);
  const [visitOpen, setVisitOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const loadController = React.useRef<AbortController | null>(null);

  const changed = React.useCallback((ids: string[]) => changedRef.current(ids), []);

  const undo = React.useCallback(async (results: StatusResult[]) => {
    // One request per earlier status: Undo returns each item to where it was.
    const groups = new Map<MaintenanceStatus, string[]>();
    for (const result of results) {
      if (result.outcome !== "done" || !result.fromStatus) continue;
      groups.set(result.fromStatus, [...(groups.get(result.fromStatus) ?? []), result.id]);
    }
    try {
      for (const [status, ids] of Array.from(groups.entries())) await bulkStatus(ids, status, "Undone");
      toast({ title: "Undone", description: "The items are back to their earlier status." });
    } catch (cause) {
      toast({ title: "Could not undo", description: cause instanceof Error ? cause.message : "Change the status again by hand.", variant: "destructive" });
    } finally {
      changed(results.map((result) => result.id));
    }
  }, [changed]);

  /** Apply a status at once. Resolve and dismiss go through the note confirm instead. */
  const applyStatus = React.useCallback(async (ids: string[], status: MaintenanceStatus, note: string | null = null): Promise<boolean> => {
    setRunning(true);
    try {
      const results = await bulkStatus(ids, status, note);
      const done = results.filter((result) => result.outcome === "done");
      const terminal = status === "RESOLVED" || status === "DISMISSED";
      toast({
        title: describeStatusResults(results, status),
        description: terminal ? "Undo by changing the status again." : undefined,
        duration: 10_000,
        action: !terminal && done.length > 0 ? (
          <ToastAction altText="Undo the status change" onClick={() => void undo(results)}>Undo</ToastAction>
        ) : undefined,
      });
      refusedRef.current?.(results.filter((result) => result.outcome === "missing").map((result) => result.id));
      changed(ids);
      return true;
    } catch (cause) {
      toast({ title: "Status not changed", description: cause instanceof Error ? cause.message : "Nothing was changed.", variant: "destructive" });
      return false;
    } finally {
      setRunning(false);
    }
  }, [changed, undo]);

  const requestStatus = React.useCallback((targets: Array<Pick<MaintenanceActionTarget, "id" | "title">>, status: MaintenanceStatus, initialNote?: string) => {
    if (targets.length === 0) return;
    if (status === "RESOLVED" || status === "DISMISSED") {
      setStatusRequest({ kind: status, ids: targets.map((target) => target.id), count: targets.length, title: targets.length === 1 ? targets[0].title : null, initialNote });
      return;
    }
    void applyStatus(targets.map((target) => target.id), status, initialNote?.trim() || null);
  }, [applyStatus]);

  const setVisibility = React.useCallback(async (target: MaintenanceActionTarget, visible: boolean) => {
    try {
      await patchMaintenanceItem(target.id, { clientVisible: visible, note: visible ? "Shown to the client" : "Hidden from the client" });
      toast({ title: visible ? "The client now sees this item" : "Hidden from the client", description: target.title });
      changed([target.id]);
    } catch (cause) {
      toast({ title: "Not changed", description: cause instanceof Error ? cause.message : "Nothing was changed.", variant: "destructive" });
    }
  }, [changed]);

  const copyLink = React.useCallback((id: string) => {
    const url = `${window.location.origin}/v2/admin/maintenance/${id}`;
    void navigator.clipboard?.writeText(url).then(
      () => toast({ title: "Link copied" }),
      () => toast({ title: "Copy the link from the address bar", variant: "destructive" }),
    );
  }, []);

  /** Loads the full item for a dialog that needs fields the list row does not carry. */
  const withItem = React.useCallback(async (id: string, use: (item: MaintenanceDetailItem) => void) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    try {
      const item = await readMaintenanceItem(id, controller.signal);
      if (controller.signal.aborted || loadController.current !== controller) return;
      use(item);
    } catch (cause) {
      if (controller.signal.aborted) return;
      toast({ title: "Could not open", description: cause instanceof Error ? cause.message : "This item could not be loaded.", variant: "destructive" });
    }
  }, []);

  const openEdit = React.useCallback((target: { id: string } | MaintenanceDetailItem) => {
    const fromItem = (item: MaintenanceDetailItem) => setEditItem({
      id: item.id, title: item.title, area: item.area, category: item.category, recommendedAction: item.recommendedAction,
      priority: item.priority, estimatedCost: item.estimatedCost, description: item.description, clientVisible: item.clientVisible,
    });
    if ("photos" in target) fromItem(target);
    else void withItem(target.id, fromItem);
  }, [withItem]);

  const openVisit = React.useCallback((target: { id: string } | MaintenanceDetailItem) => {
    const fromItem = (item: MaintenanceDetailItem) => {
      const address = [item.property.address, item.property.suburb].filter(Boolean).join(", ");
      setVisitTarget({
        id: item.id,
        title: item.title,
        propertyLine: [item.property.name, address].filter(Boolean).join(" · "),
        assignedWorkerId: item.assignedWorker?.id ?? null,
        assignedWorkerName: item.assignedWorker?.name ?? null,
        scheduledFor: item.scheduledFor,
        shareAccess: item.shareAccess,
        contactPersonUserId: item.contactPerson?.id ?? item.contactPersonUserId ?? null,
      });
      setVisitOpen(true);
    };
    if ("photos" in target) fromItem(target);
    else void withItem(target.id, fromItem);
  }, [withItem]);

  const openAssign = React.useCallback((targets: Array<Pick<MaintenanceActionTarget, "id" | "title" | "assignedWorkerId">>, segment: "MAINTENANCE" | "CLEANER" | "QA" = "MAINTENANCE") => {
    if (targets.length === 0) return;
    setAssignTarget((current) => {
      const ids = targets.map((target) => target.id);
      // The same item keeps its draft; another item starts fresh.
      if (current && current.ids.join(",") === ids.join(",")) return current;
      return { ids, title: targets.length === 1 ? targets[0].title : `${targets.length} items`, assignedWorkerId: targets.length === 1 ? targets[0].assignedWorkerId : null };
    });
    setAssignSegment(segment);
    setAssignOpen(true);
  }, []);

  /** The row menu / More menu for one item, grouped as the board draws it. */
  const menuItems = React.useCallback((target: MaintenanceActionTarget, extra: { openPage?: boolean; edit?: boolean } = {}): ERowMenuItem[] => {
    const statusItems: ERowMenuItem[] = (Object.keys(STATUS_ACTION_LABEL) as MaintenanceStatus[])
      .filter((status) => status !== target.status)
      .filter((status) => status !== "OPEN" || target.status === "RESOLVED" || target.status === "DISMISSED")
      .map((status, index) => ({
        key: `status-${status}`,
        heading: index === 0 ? "Status" : undefined,
        label: STATUS_ACTION_LABEL[status],
        badge: status === "RESOLVED" || status === "DISMISSED" ? "note" : undefined,
        onSelect: () => requestStatus([target], status),
      }));
    const items: ERowMenuItem[] = [];
    if (extra.openPage) items.push({ key: "open", label: "Open full page", href: `/v2/admin/maintenance/${target.id}` });
    items.push(...statusItems.map((item, index) => (index === 0 && extra.openPage ? { ...item, separated: true } : item)));
    items.push(
      { key: "assign", heading: "Work", separated: true, label: target.assignedWorkerId ? "Reassign…" : "Assign…", onSelect: () => openAssign([target]) },
      { key: "visit", label: "Schedule visit…", onSelect: () => openVisit({ id: target.id }) },
      { key: "price", label: target.costApprovalStatus ? "Update client price…" : "Send client price…", onSelect: () => setPriceTarget({ id: target.id, title: target.title, quotedCost: target.quotedCost, costApprovalStatus: target.costApprovalStatus }) },
      { key: "link", label: target.jobId ? "Move to another job…" : "Link to a job…", onSelect: () => setLinkTarget({ id: target.id, title: target.title, propertyId: target.propertyId, propertyName: target.propertyName, jobId: target.jobId }) },
    );
    if (extra.edit) items.push({ key: "edit", label: "Edit details…", onSelect: () => openEdit({ id: target.id }) });
    items.push(
      { key: "visibility", label: target.clientVisible ? "Hide from the client" : "Show to the client", onSelect: () => void setVisibility(target, !target.clientVisible) },
      { key: "copy", label: "Copy link", onSelect: () => copyLink(target.id) },
    );
    return items;
  }, [copyLink, openAssign, openEdit, openVisit, requestStatus, setVisibility]);

  function done(message: string, ids: string[]) {
    toast({ title: message });
    changed(ids);
  }

  const dialogs = (
    <>
      <StatusNoteDialog
        request={statusRequest}
        onClose={() => setStatusRequest(null)}
        onConfirm={async (note) => {
          if (!statusRequest) return false;
          const ok = await applyStatus(statusRequest.ids, statusRequest.kind, note);
          if (ok) setStatusRequest(null);
          return ok;
        }}
      />
      <PriceDialog target={priceTarget} onClose={() => setPriceTarget(null)} onSaved={(message) => { const id = priceTarget?.id; setPriceTarget(null); done(message, id ? [id] : []); }} />
      <LinkJobDialog target={linkTarget} onClose={() => setLinkTarget(null)} onSaved={(message) => { const id = linkTarget?.id; setLinkTarget(null); done(message, id ? [id] : []); }} />
      <EditDetailsDialog item={editItem} onClose={() => setEditItem(null)} onSaved={(message) => { const id = editItem?.id; setEditItem(null); done(message, id ? [id] : []); }} />
      <AssignSheet
        open={assignOpen}
        target={assignTarget}
        initialSegment={assignSegment}
        canCreateLogin={isAdmin}
        onClose={() => setAssignOpen(false)}
        onDone={(result: AssignDone) => {
          const ids = assignTarget?.ids ?? [];
          const refused = result.refused ?? [];
          if (refused.length > 0) {
            refusedRef.current?.(refused.map((entry) => entry.id));
            toast({ title: result.message, description: refused.map((entry) => entry.reason).filter(Boolean).slice(0, 2).join(" "), variant: "destructive" });
            changed(ids);
          } else {
            done(result.message, ids);
          }
          // A roster save keeps the sheet open for the next role; a visit worker closes it.
          if (result.kind === "worker") setAssignOpen(false);
        }}
      />
      <VisitSheet
        open={visitOpen}
        target={visitTarget}
        timeZone={timeZone}
        onClose={() => setVisitOpen(false)}
        onAssignFirst={() => {
          setVisitOpen(false);
          if (visitTarget) openAssign([{ id: visitTarget.id, title: visitTarget.title, assignedWorkerId: null }]);
        }}
        onSaved={(message) => {
          setVisitOpen(false);
          done(message, visitTarget ? [visitTarget.id] : []);
        }}
      />
    </>
  );

  return {
    dialogs,
    running,
    menuItems,
    requestStatus,
    applyStatus,
    openAssign,
    openVisit,
    openEdit,
    openPrice: setPriceTarget,
    openLinkJob: setLinkTarget,
    setVisibility,
    copyLink,
    quickStatuses: QUICK_STATUSES,
  };
}

export type MaintenanceActions = ReturnType<typeof useMaintenanceActions>;
