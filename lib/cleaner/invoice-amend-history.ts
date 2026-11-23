/**
 * Reading office amendments back (2026-11-23): for the payee's invoice list,
 * the office review page and both PDFs. Every figure is the stored one; the
 * original total is revision 1's "before" (the payee's own submission).
 */
import { db } from "@/lib/db";
import { describeAmendment, type LineChange } from "./invoice-amend-rules";
import type { AmendNoticeRecord } from "./invoice-amend-notify";
import type { SnapshotAmendment } from "./invoice-snapshot-pdf";

export type AmendmentView = {
  revision: number;
  at: string;
  actorName: string | null;
  actorRole: string;
  reason: string;
  note: string | null;
  statusBefore: string;
  beforeTotal: number;
  afterTotal: number;
  beforeHours: number;
  afterHours: number;
  /** Each change in plain words, ending with the total. */
  changes: string[];
  /** The Xero bill id when the invoice was already in Xero at the time. */
  xeroBillId: string | null;
  notice: AmendNoticeRecord | null;
};

export type AmendmentHistory = {
  /** The payee's own submitted total (before any amendment). */
  originalTotal: number;
  amendments: AmendmentView[];
};

type RevisionRow = {
  revision: number;
  createdAt: Date;
  actorUserId: string;
  actorRole: string;
  reason: string;
  note: string | null;
  statusBefore: string;
  beforeTotal: number;
  afterTotal: number;
  beforeHours: number;
  afterHours: number;
  changes: unknown;
  xeroBillId: string | null;
  notification: unknown;
};

function toView(row: RevisionRow, names: Map<string, string | null>): AmendmentView {
  const changes = (Array.isArray(row.changes) ? row.changes : []) as LineChange[];
  return {
    revision: row.revision,
    at: row.createdAt.toISOString(),
    actorName: names.get(row.actorUserId) ?? null,
    actorRole: row.actorRole,
    reason: row.reason,
    note: row.note,
    statusBefore: row.statusBefore,
    beforeTotal: row.beforeTotal,
    afterTotal: row.afterTotal,
    beforeHours: row.beforeHours,
    afterHours: row.afterHours,
    changes: describeAmendment({ changes, beforeTotal: row.beforeTotal, afterTotal: row.afterTotal, beforeHours: row.beforeHours, afterHours: row.afterHours }),
    xeroBillId: row.xeroBillId,
    notice: (row.notification as AmendNoticeRecord | null) ?? null,
  };
}

/** Amendment histories for several invoices (newest amendment first); invoices never amended are absent. */
export async function loadAmendmentHistories(submissionIds: readonly string[]): Promise<Map<string, AmendmentHistory>> {
  const histories = new Map<string, AmendmentHistory>();
  if (submissionIds.length === 0) return histories;
  const rows = await db.cleanerInvoiceRevision.findMany({
    where: { submissionId: { in: Array.from(new Set(submissionIds)) } },
    orderBy: [{ submissionId: "asc" }, { revision: "asc" }],
  });
  if (rows.length === 0) return histories;
  const actorIds = Array.from(new Set(rows.map((row) => row.actorUserId)));
  const actors = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const names = new Map(actors.map((actor) => [actor.id, actor.name || actor.email || null]));
  for (const row of rows) {
    const history = histories.get(row.submissionId) ?? { originalTotal: row.beforeTotal, amendments: [] };
    history.amendments.unshift(toView(row, names));
    histories.set(row.submissionId, history);
  }
  return histories;
}

export async function loadAmendmentHistory(submissionId: string): Promise<AmendmentHistory | null> {
  return (await loadAmendmentHistories([submissionId])).get(submissionId) ?? null;
}

/** The latest amendment in the shape the invoice PDF prints, or null when never amended. */
export function latestSnapshotAmendment(history: AmendmentHistory | null): SnapshotAmendment | null {
  const latest = history?.amendments[0];
  if (!history || !latest) return null;
  return { revision: latest.revision, at: new Date(latest.at), originalTotal: history.originalTotal, changes: latest.changes, reason: latest.reason, note: latest.note };
}

/**
 * What the payee sees about office amendments on their own invoice: each
 * amendment's changes, reason and date, and the original against the amended
 * total. Who in the office made it and the notice outcomes are office records
 * and are not included.
 */
export type PayeeAmendmentView = {
  originalTotal: number;
  amendedTotal: number;
  amendments: Array<{ revision: number; at: string; reason: string; note: string | null; changes: string[] }>;
};

export function payeeAmendmentView(history: AmendmentHistory | null): PayeeAmendmentView | null {
  if (!history || history.amendments.length === 0) return null;
  return {
    originalTotal: history.originalTotal,
    amendedTotal: history.amendments[0].afterTotal,
    amendments: history.amendments.map((amendment) => ({ revision: amendment.revision, at: amendment.at, reason: amendment.reason, note: amendment.note, changes: amendment.changes })),
  };
}
