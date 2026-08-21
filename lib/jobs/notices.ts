/**
 * JOB NOTICES — one-off information for one clean.
 *
 * Not a task. A task asks the cleaner to DO something and is proved with a
 * photo or a note; a notice only asks them to KNOW something. "The side gate
 * key is with the neighbour this week", "the owner's dog is inside", "lift is
 * out until Thursday". Until now the only place to put that was the single
 * free-form internal note, so a second piece of information overwrote the
 * first, and nobody could tell when it had been added or by whom.
 *
 * Notices are stored on the job meta rather than as JobTask rows precisely
 * because they are not work: a JobTask appears in task counts, in completion
 * percentages, and in the "outstanding tasks" blocks. A notice that made a job
 * look incomplete would be worse than no notice at all.
 *
 * This module is the ONLY place that decides how a notice renders. Both the
 * open-the-job list and the start-of-clean acknowledgement gate read from here
 * — the recurring bug in this codebase is one rule implemented in two places
 * with one copy updated, and this notice text has exactly two readers.
 *
 * PURE — no DB, no I/O.
 */

/**
 * IMPORTANT rides above ordinary notices and is worded more firmly. It is
 * deliberately a two-value scale: a three-tier severity invites everything to
 * be filed as the middle one, and a cleaner reading eight "medium" notices at
 * 7am reads none of them.
 */
export type JobNoticeUrgency = "INFO" | "IMPORTANT";

export interface JobNotice {
  id: string;
  /** The information itself. Free text — this is the whole point of a notice. */
  body: string;
  urgency: JobNoticeUrgency;
  /** Who wrote it, for the cleaner's benefit — "who do I ask about this?". */
  authorName?: string;
  /** ISO timestamp. Optional: notices written before this field existed. */
  createdAt?: string;
  /**
   * Public URLs of reference photos. A notice about a stain, a broken latch
   * or where the spare key now lives is far clearer with the picture the
   * person writing it was looking at.
   */
  imageUrls?: string[];
}

/** Stable id shared by the read-first list and the start-briefing ack. */
export const noticeItemId = (noticeId: string) => `notice-${noticeId}`;

const TITLE: Record<JobNoticeUrgency, string> = {
  IMPORTANT: "Important — read before you start",
  INFO: "Notice for this job",
};

export interface RenderedNotice {
  id: string;
  /** The briefing / read-first item id. */
  itemId: string;
  title: string;
  detail: string;
  urgency: JobNoticeUrgency;
  /** "Added by Sam · 14 Aug", or null when neither is recorded. */
  attribution: string | null;
  imageUrls: string[];
}

/**
 * Notices, ordered and rendered for display.
 *
 * IMPORTANT first, then authored order inside each group. Authored order
 * because notices accumulate over the life of a job and reading them in the
 * order they were written is the order they make sense in — a later notice
 * often amends an earlier one. Sorting on createdAt instead would strand every
 * notice missing that field at one end.
 */
export function renderJobNotices(notices: readonly JobNotice[] | undefined): RenderedNotice[] {
  if (!Array.isArray(notices) || notices.length === 0) return [];

  const withIndex = notices
    .filter((notice) => typeof notice?.body === "string" && notice.body.trim().length > 0)
    .map((notice, index) => ({ notice, index }));

  withIndex.sort((a, b) => {
    const rank = (n: JobNotice) => (n.urgency === "IMPORTANT" ? 0 : 1);
    const byUrgency = rank(a.notice) - rank(b.notice);
    return byUrgency !== 0 ? byUrgency : a.index - b.index;
  });

  return withIndex.map(({ notice }) => {
    // Normalise once. A urgency read back from stored JSON can be any string,
    // and using the raw value to pick the title would leave an old or
    // hand-edited record with no heading at all.
    const urgency: JobNoticeUrgency =
      notice.urgency === "IMPORTANT" ? "IMPORTANT" : "INFO";
    return {
      id: notice.id,
      itemId: noticeItemId(notice.id),
      title: TITLE[urgency],
      detail: notice.body.trim(),
      urgency,
      attribution: buildAttribution(notice),
      imageUrls: Array.isArray(notice.imageUrls)
        ? notice.imageUrls.filter((url: unknown): url is string => typeof url === "string" && url.trim().length > 0)
        : [],
    };
  });
}

function buildAttribution(notice: JobNotice): string | null {
  const who = typeof notice.authorName === "string" ? notice.authorName.trim() : "";
  const when = formatNoticeDate(notice.createdAt);
  if (who && when) return `Added by ${who} · ${when}`;
  if (who) return `Added by ${who}`;
  if (when) return `Added ${when}`;
  return null;
}

/**
 * Short Sydney-local date. Notices are read on a phone next to the text they
 * describe, so the year is noise — a notice on a job is days old, not years.
 */
function formatNoticeDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    return null;
  }
}
