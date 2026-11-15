/**
 * "QA issues after" for Forms › Results and stats (board "Forms: results and
 * stats", owner default 2026-11-17): QA issues raised on the SAME JOB, in the
 * SAME AREA (the form's location tag), AFTER the job's submission of this
 * form. It is a link of job and area, never proof that a question caused the
 * issue, and the page says so.
 *
 * How an issue gets an area, most direct first:
 *   1. the cleaner photos the inspector attached to it (`cleanerMediaIds` →
 *      SubmissionMedia.fieldId → that question's location tag), when they all
 *      point at one area;
 *   2. the QA section the graded criterion sits in, matched to the cleaner
 *      form's section by title (lib/qa/section-match.ts, the pairing the
 *      inspection screen already uses), when every tagged question of that
 *      cleaner section carries the same tag.
 * Anything else is "not placed" and counted as such: never put in an area by
 * guessing, never dropped silently.
 *
 * PURE: no database.
 */
import { matchCleanerSection } from "@/lib/qa/section-match";

export type QaIssueForArea = {
  id: string;
  jobId: string;
  createdAt: Date;
  category: string;
  cleanerName: string | null;
  falseConfirmation: "NONE" | "SUSPECTED" | "CONFIRMED" | "REJECTED";
  /** Field ids of the cleaner photos attached to the issue (SubmissionMedia.fieldId). */
  cleanerMediaFieldIds: string[];
  /** Title of the QA section holding the graded criterion, when it could be read. */
  qaSectionTitle: string | null;
};

export type FormAreaMap = {
  /** Cleaner form question id → its location tag. */
  areaByFieldId: ReadonlyMap<string, string>;
  /** Cleaner form section title → the one area all its tagged questions share (null when mixed or none). */
  areaBySectionTitle: ReadonlyMap<string, string | null>;
};

export type AreaIssueTally = {
  count: number;
  confirmedFalse: number;
  categories: Map<string, number>;
  cleaners: Map<string, number>;
};

export type QaIssuesAfter = {
  byArea: Map<string, AreaIssueTally>;
  /** Issues after a submission whose area could not be worked out. */
  notPlaced: number;
  /** Issues after a submission of this form, placed or not. */
  considered: number;
};

export function buildFormAreaMap(sections: ReadonlyArray<{ title: string; fields: ReadonlyArray<{ id: string; locationTag?: string }> }>): FormAreaMap {
  const areaByFieldId = new Map<string, string>();
  const areaBySectionTitle = new Map<string, string | null>();
  for (const section of sections) {
    const tags = new Set<string>();
    for (const field of section.fields) {
      if (!field.locationTag) continue;
      areaByFieldId.set(field.id, field.locationTag);
      tags.add(field.locationTag);
    }
    areaBySectionTitle.set(section.title, tags.size === 1 ? Array.from(tags)[0] : null);
  }
  return { areaByFieldId, areaBySectionTitle };
}

/** The area an issue belongs to, or null when it cannot be told reliably. */
export function areaOfIssue(issue: QaIssueForArea, map: FormAreaMap): string | null {
  const mediaAreas = new Set<string>();
  let unknownMedia = false;
  for (const fieldId of issue.cleanerMediaFieldIds) {
    const area = map.areaByFieldId.get(fieldId);
    if (area) mediaAreas.add(area);
    else unknownMedia = true;
  }
  if (mediaAreas.size === 1 && !unknownMedia) return Array.from(mediaAreas)[0];
  if (mediaAreas.size > 1) return null;
  if (!issue.qaSectionTitle) return null;
  const cleanerTitle = matchCleanerSection(issue.qaSectionTitle, Array.from(map.areaBySectionTitle.keys()));
  return cleanerTitle ? map.areaBySectionTitle.get(cleanerTitle) ?? null : null;
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/**
 * Tally issues raised after each job's FIRST submission of the form in the
 * window. An issue on a job without such a submission is not considered.
 */
export function tallyQaIssuesAfter(
  submissions: ReadonlyArray<{ jobId: string; createdAt: Date }>,
  issues: ReadonlyArray<QaIssueForArea>,
  map: FormAreaMap,
): QaIssuesAfter {
  const firstSubmission = new Map<string, number>();
  for (const submission of submissions) {
    const at = submission.createdAt.getTime();
    const current = firstSubmission.get(submission.jobId);
    if (current === undefined || at < current) firstSubmission.set(submission.jobId, at);
  }
  const result: QaIssuesAfter = { byArea: new Map(), notPlaced: 0, considered: 0 };
  for (const issue of issues) {
    const submittedAt = firstSubmission.get(issue.jobId);
    if (submittedAt === undefined || issue.createdAt.getTime() < submittedAt) continue;
    result.considered += 1;
    const area = areaOfIssue(issue, map);
    if (!area) {
      result.notPlaced += 1;
      continue;
    }
    const tally = result.byArea.get(area) ?? { count: 0, confirmedFalse: 0, categories: new Map(), cleaners: new Map() };
    tally.count += 1;
    if (issue.falseConfirmation === "CONFIRMED") tally.confirmedFalse += 1;
    bump(tally.categories, issue.category);
    if (issue.cleanerName) bump(tally.cleaners, issue.cleanerName);
    result.byArea.set(area, tally);
  }
  return result;
}

/** The most frequent key and its count, or null for an empty map. */
export function topEntry(map: ReadonlyMap<string, number>): { key: string; count: number } | null {
  let best: { key: string; count: number } | null = null;
  map.forEach((count, key) => {
    if (!best || count > best.count) best = { key, count };
  });
  return best;
}
