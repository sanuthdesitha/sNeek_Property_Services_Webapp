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
 * There is deliberately no "add these to the PDF" switch yet. The report
 * generator builds its task photos from FORM SUBMISSION media matched by
 * proofFieldId, not from JobTaskAttachment — the same split that caused this
 * bug — so the toggle would have had nothing to switch. It needs the report
 * view-model to read both stores first.
 */

import * as React from "react";
import Image from "next/image";
import { CheckCircle2, XCircle, FileText, ListChecks } from "lucide-react";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import type { TaskRequestRow } from "@/components/v2/admin/jobs/job-detail-reviews";

function isImage(mediaType: string): boolean {
  const value = mediaType.toUpperCase();
  return value === "PHOTO" || value === "IMAGE";
}

export function TaskEvidence({ tasks }: { tasks: TaskRequestRow[] }) {
  // A task with neither proof nor a note has nothing to show. Listing it would
  // pad the section with rows that say "no evidence", which is the same as
  // saying nothing but takes longer to read.
  const evidenced = tasks.filter(
    (task) => (task.proof?.length ?? 0) > 0 || Boolean(task.completionNote)
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
        )}
      </ECardBody>
    </ECard>
  );
}
