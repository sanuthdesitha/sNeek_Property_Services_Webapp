"use client";

/**
 * ESTATE cleaner — "Read first" block. Merges the human-authored context a
 * cleaner most needs before starting (admin notes, client requests, job tasks,
 * carry-forward items) into one amber-flagged card, source-chipped and
 * collapsible. Pure props — no data fetching. Styled on Estate tokens only.
 */
import * as React from "react";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";

export type ReadFirstSource = "ADMIN" | "CLIENT" | "TASK" | "CARRY_FORWARD";

export interface ReadFirstItem {
  source: ReadFirstSource;
  title: string;
  body?: string | null;
  images?: { url: string; label?: string }[];
}

const SOURCE_LABEL: Record<ReadFirstSource, string> = {
  ADMIN: "Admin note",
  CLIENT: "Client request",
  TASK: "Task",
  CARRY_FORWARD: "From last clean",
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Merge the various job-context sources into a single ordered "read first"
 * list. Order is deliberate: ADMIN → CLIENT → TASK → CARRY_FORWARD, so the
 * most authoritative instructions surface at the top. Empty / missing inputs
 * contribute nothing.
 */
export function buildReadFirstItems(payload: {
  jobMeta?: any;
  jobTasks?: any[];
  carryForwardTasks?: any[];
}): ReadFirstItem[] {
  const items: ReadFirstItem[] = [];
  const jobMeta = payload.jobMeta ?? {};

  // ADMIN — the free-form internal note.
  const adminNote = str(jobMeta.internalNoteText);
  if (adminNote) {
    items.push({ source: "ADMIN", title: "Admin note", body: adminNote });
  }

  // CLIENT — quote additionals, then admin-authored special requests.
  const additionals = Array.isArray(jobMeta.additionals) ? jobMeta.additionals : [];
  for (const extra of additionals) {
    const title = str(extra?.label);
    if (!title) continue;
    items.push({ source: "CLIENT", title, body: str(extra?.instructions) || null });
  }
  const specialRequests = Array.isArray(jobMeta.specialRequestTasks)
    ? jobMeta.specialRequestTasks
    : [];
  for (const task of specialRequests) {
    const title = str(task?.title);
    if (!title) continue;
    items.push({ source: "CLIENT", title, body: str(task?.description) || null });
  }

  // TASK — approved cleaner job tasks, with any REQUEST_REFERENCE images.
  const jobTasks = Array.isArray(payload.jobTasks) ? payload.jobTasks : [];
  for (const task of jobTasks) {
    const title = str(task?.title);
    if (!title) continue;
    const attachments = Array.isArray(task?.attachments) ? task.attachments : [];
    const images = attachments
      .filter((att: any) => String(att?.kind ?? "") === "REQUEST_REFERENCE" && str(att?.url))
      .map((att: any) => ({ url: str(att.url), label: str(att?.label) || undefined }));
    items.push({
      source: "TASK",
      title,
      body: str(task?.description) || null,
      ...(images.length > 0 ? { images } : {}),
    });
  }

  // CARRY_FORWARD — tasks not finished on the previous clean.
  const carryForward = Array.isArray(payload.carryForwardTasks) ? payload.carryForwardTasks : [];
  for (const task of carryForward) {
    const body = str(task?.description);
    if (!body) continue;
    items.push({ source: "CARRY_FORWARD", title: "Unfinished task", body });
  }

  return items;
}

function SourceChip({ source }: { source: ReadFirstSource }) {
  return (
    <span className="inline-flex items-center rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 py-0.5 text-[0.625rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-secondary))]">
      {SOURCE_LABEL[source]}
    </span>
  );
}

function ReadFirstRow({ item }: { item: ReadFirstItem }) {
  const galleryItems: MediaGalleryItem[] = (item.images ?? []).map((img, i) => ({
    id: `${img.url}-${i}`,
    url: img.url,
    label: img.label,
  }));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <SourceChip source={item.source} />
        <p className="text-[0.875rem] font-[600] text-[hsl(var(--e-foreground))]">{item.title}</p>
      </div>
      {item.body ? (
        <p className="whitespace-pre-wrap break-words text-[0.8125rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
          {item.body}
        </p>
      ) : null}
      {galleryItems.length > 0 ? (
        <MediaGallery
          items={galleryItems}
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
          title={item.title}
        />
      ) : null}
    </div>
  );
}

export function ReadFirstBlock({
  items,
  defaultVisible = 3,
}: {
  items: ReadFirstItem[];
  defaultVisible?: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (!items || items.length === 0) return null;

  const showAll = expanded || items.length <= defaultVisible;
  const visible = showAll ? items : items.slice(0, defaultVisible);
  const hidden = items.length - visible.length;

  return (
    <section className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] border-l-[3px] border-l-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-4">
      <p className="mb-3 inline-flex items-center gap-2 text-[0.6875rem] font-[600] uppercase tracking-[0.14em] text-[hsl(var(--e-foreground))]">
        Read first
      </p>
      <div className="space-y-3.5">
        {visible.map((item, i) => (
          <React.Fragment key={`${item.source}-${i}`}>
            {i > 0 ? <hr className="border-t border-[hsl(var(--e-border)/0.6)]" /> : null}
            <ReadFirstRow item={item} />
          </React.Fragment>
        ))}
      </div>
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] hover:underline"
        >
          Show all ({items.length})
        </button>
      ) : null}
    </section>
  );
}
