"use client";

/**
 * "Open case" and "Log lost item" from the job's Linked card: the existing
 * Cases and Lost and found create dialogs, unchanged (same routes and rules).
 * They do not take a preset job, so the office picks this job in the dialog;
 * the page refreshes afterwards so the new link appears.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";
import { CaseNewDialog } from "@/components/v2/admin/cases/case-new-dialog";
import { LogItemDialog } from "@/components/v2/admin/lost-found/log-item-dialog";

export function JobLinkedActions({ canCase, canLostItem, timeZone }: { canCase: boolean; canLostItem: boolean; timeZone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"case" | "lost" | null>(null);
  if (!canCase && !canLostItem) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {canCase ? <EButton size="sm" variant="outline" onClick={() => setOpen("case")}>Open case</EButton> : null}
      {canLostItem ? <EButton size="sm" variant="outline" onClick={() => setOpen("lost")}>Log lost item</EButton> : null}
      {canCase ? (
        <CaseNewDialog open={open === "case"} onClose={() => setOpen(null)} onCreated={() => { setOpen(null); router.refresh(); }} />
      ) : null}
      {canLostItem ? (
        <LogItemDialog open={open === "lost"} timeZone={timeZone} onClose={() => setOpen(null)} onCreated={() => { setOpen(null); router.refresh(); }} />
      ) : null}
    </div>
  );
}
