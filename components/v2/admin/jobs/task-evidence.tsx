"use client";

/**
 * Evidence a cleaner uploaded when finishing an admin- or client-requested task.
 *
 * This existed in the database and appeared nowhere. The proof is written to
 * JobTaskAttachment as COMPLETION_PROOF / FAILURE_PROOF, while every reader
 * filtered attachments to REQUEST_REFERENCE — so a cleaner photographed the
 * thing they were asked to do, and the person who asked never saw it.
 *
 * It lives beside the forms rather than beside the task request, because the
 * question it answers is "what did we get back from this clean", which is what
 * the whole Forms & report tab is for.
 *
 * The report toggle writes JobMeta.includeTaskPhotosInReport and regenerates,
 * rather than varying the PDF per download: the report is generated once and
 * served to everyone, so a per-click variant would quietly change what the
 * client sees too. It defaults ON — the photo was taken because someone
 * asked for it.
 */

import * as React from "react";
import Image from "next/image";
import { CheckCircle2, XCircle, FileText, ListChecks, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { ESwitch } from "@/components/v2/admin/estate-kit";
import type { TaskRequestRow } from "@/components/v2/admin/jobs/job-detail-reviews";

function isImage(mediaType: string): boolean {
  const value = mediaType.toUpperCase();
  return value === "PHOTO" || value === "IMAGE";
}

export function TaskEvidence({
  jobId,
  tasks,
  includeInReport,
}: {
  jobId: string;
  tasks: TaskRequestRow[];
  includeInReport: boolean;
}) {
  const [included, setIncluded] = React.useState(includeInReport);
  const [saving, setSaving] = React.useState(false);

  async function setInclusion(next: boolean) {
    const previous = included;
    setIncluded(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeTaskPhotosInReport: next }),
      });
      if (!res.ok) throw new Error("Could not save that.");
      // The report is stored, not rendered per download, so the setting
      // means nothing until it is rebuilt.
      await fetch(`/api/admin/reports/${jobId}/generate`, { method: "POST" }).catch(
        () => {}
      );
      toast({
        title: next
          ? "Task photos will appear in the report"
          : "Task photos removed from the report",
        description: "The report has been rebuilt.",
      });
    } catch (err: any) {
      // Put the switch back: leaving it on the new value would claim a
      // change the report does not have.
      setIncluded(previous);
      toast({
        title: "Could not update the report",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  // A task with neither proof nor a note has nothing to show. Listing it would
  // pad the section with rows that say "no evidence", which is the same as
  // saying nothing but takes longer to read.
  const evidenced = tasks.filter(
    (task) => (task.proof?.length ?? 0) > 0 || Boolean(task.completionNote)
  );

  const photoCount = evidenced.reduce(
    (sum, task) => sum + (task.proof?.filter((p) => isImage(p.mediaType)).length ?? 0),
    0
  );

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="flex flex-wrap items-center gap-2 text-[0.95rem]">
          <ListChecks className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
          Task evidence
          {evidenced.length > 0 ? (
            <EBadge tone="neutral" soft>
              {evidenced.length} {evidenced.length === 1 ? "task" : "tasks"}
            </EBadge>
          ) : null}
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="pt-0">
        {evidenced.length === 0 ? (
          <EEmptyState
            title="Nothing submitted yet"
            description="Photos and notes a cleaner adds when completing a requested task appear here."
          />
        ) : (
          <>
            {photoCount > 0 ? (
              <label className="mb-4 flex items-start justify-between gap-3 rounded-[var(--e-radius-md)] border border-[hsl(var(--e-border))] px-3 py-2">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[0.8125rem] font-medium text-[hsl(var(--e-text))]">
                    Include in the downloaded report
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  </span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                    {photoCount} task {photoCount === 1 ? "photo" : "photos"}. Turning this off
                    rebuilds the report without them — for everyone who opens it, including
                    the client.
                  </span>
                </span>
                <ESwitch checked={included} disabled={saving} onCheckedChange={setInclusion} />
              </label>
            ) : null}
            <ul className="space-y-4">
            {evidenced.map((task) => {
              const failed = task.proof?.some((p) => p.kind === "FAILURE_PROOF") ?? false;
              const done = task.executionStatus === "COMPLETED";
              return (
                <li
                  key={task.id}
                  className="space-y-2 border-t border-[hsl(var(--e-border))] pt-3 first:border-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-success))]" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-danger))]" />
                    )}
                    <span className="text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">
                      {task.title}
                    </span>
                    {task.source ? (
                      <EBadge tone={task.source === "ADMIN" ? "gold" : "info"} soft>
                        {task.source === "ADMIN" ? "Admin asked" : "Client asked"}
                      </EBadge>
                    ) : null}
                    {failed && !done ? (
                      <EBadge tone="danger" soft>
                        Not completed
                      </EBadge>
                    ) : null}
                  </div>

                  {task.completionNote ? (
                    <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      <span className="text-[hsl(var(--e-text-faint))]">Cleaner note: </span>
                      {task.completionNote}
                    </p>
                  ) : null}

                  {task.proof && task.proof.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {task.proof.map((item) =>
                        isImage(item.mediaType) ? (
                          <a
                            key={item.id}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="relative h-20 w-20 overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))]"
                            title={item.label ?? "Task photo"}
                          >
                            <Image
                              src={item.url}
                              alt={item.label ?? "Task photo"}
                              fill
                              sizes="80px"
                              className="object-cover"
                            />
                          </a>
                        ) : (
                          <a
                            key={item.id}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] text-[0.6875rem] text-[hsl(var(--e-text-faint))]"
                          >
                            <FileText className="h-4 w-4" />
                            {item.mediaType.toLowerCase()}
                          </a>
                        )
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
            </ul>
          </>
        )}
      </ECardBody>
    </ECard>
  );
}
