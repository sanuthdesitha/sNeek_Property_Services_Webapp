"use client";

/**
 * ESTATE cleaner — "Read first" block. Merges the human-authored context a
 * cleaner most needs before starting (admin notes, client requests, job tasks,
 * carry-forward items) into one amber-flagged card, source-chipped and
 * collapsible. Pure props — no data fetching. Styled on Estate tokens only.
 */
import * as React from "react";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";
import { resolveRuleTime } from "@/lib/jobs/meta";
import { renderJobNotices } from "@/lib/jobs/notices";

/**
 * TIMING and NOTICE lead the list. A late-checkout rule and a one-off notice
 * are the two things a cleaner cannot recover from by working harder — they
 * have to be known BEFORE the first door opens, not found under "show all".
 */
export type ReadFirstSource =
  | "TIMING"
  | "NOTICE"
  | "ADMIN"
  | "CLIENT"
  | "TASK"
  | "CARRY_FORWARD";

/** Sources that must never be collapsed behind the fold. */
const ALWAYS_VISIBLE_SOURCES: ReadFirstSource[] = ["TIMING", "NOTICE"];

export interface ReadFirstItem {
  source: ReadFirstSource;
  title: string;
  body?: string | null;
  images?: { url: string; label?: string }[];
}

const SOURCE_LABEL: Record<ReadFirstSource, string> = {
  TIMING: "Timing",
  NOTICE: "Notice",
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
  maintenanceVisits?: any[];
}): ReadFirstItem[] {
  const items: ReadFirstItem[] = [];
  const jobMeta = payload.jobMeta ?? {};

  // TIMING — the guests' hours. These were only ever drawn as separate
  // banners further down the page, so a cleaner who scrolled straight to
  // the checklist could miss that the property is occupied until 11am.
  const lateCheckout = resolveRuleTime(jobMeta.lateCheckout);
  if (lateCheckout) {
    items.push({
      source: "TIMING",
      title: `Do not start before ${lateCheckout}`,
      body: "Guests are still in the property until then. Do not enter or begin the clean.",
    });
  }
  const earlyCheckin = resolveRuleTime(jobMeta.earlyCheckin);
  if (earlyCheckin) {
    items.push({
      source: "TIMING",
      title: `Property must be guest-ready by ${earlyCheckin}`,
      body: "New guests check in early. Everything must be finished and reset before this time.",
    });
  }

  // MAINTENANCE — somebody is coming to the property today. Sits with the
  // notices because that is what it is to the cleaner: information that
  // changes their day, not work assigned to them.
  const visits = Array.isArray(payload.maintenanceVisits) ? payload.maintenanceVisits : [];
  for (const visit of visits) {
    const title = str(visit?.title);
    if (!title) continue;
    const lines = Array.isArray(visit?.lines) ? visit.lines.filter(Boolean) : [];
    items.push({ source: "NOTICE", title, body: lines.join(String.fromCharCode(10)) || null });
  }

  // NOTICE — one-off information for this clean. Ordered and worded by
  // lib/jobs/notices so this list and the start-of-clean gate cannot drift.
  for (const notice of renderJobNotices(jobMeta.notices)) {
    items.push({
      source: "NOTICE",
      title: notice.title,
      body: notice.attribution
        ? `${notice.detail}\n\n${notice.attribution}`
        : notice.detail,
      // Shown here as well as at the start-of-clean gate. A cleaner opens the
      // job when they accept it — often days before they stand at the door —
      // and a photo of the latch is worth most while they can still ask about
      // it, not only in the dialog that stands between them and clocking in.
      ...(notice.imageUrls.length > 0
        ? { images: notice.imageUrls.map((url) => ({ url })) }
        : {}),
    });
  }

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
  heading = "Read first",
}: {
  items: ReadFirstItem[];
  defaultVisible?: number;
  /** Kicker shown at the top of the block (rendered uppercase). */
  heading?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  if (!items || items.length === 0) return null;

  // The fold may never swallow a timing rule or a notice: those lead the
  // list, so widening the window to cover them keeps "show all" useful for
  // the tasks below without hiding anything time-critical.
  const criticalCount = items.filter((item) =>
    ALWAYS_VISIBLE_SOURCES.includes(item.source)
  ).length;
  const windowSize = Math.max(defaultVisible, criticalCount);
  const showAll = expanded || items.length <= windowSize;
  const visible = showAll ? items : items.slice(0, windowSize);
  const hidden = items.length - visible.length;

  return (
    <section className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] border-l-[3px] border-l-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-4">
      <p className="mb-3 inline-flex items-center gap-2 text-[0.6875rem] font-[600] uppercase tracking-[0.14em] text-[hsl(var(--e-foreground))]">
        {heading}
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
