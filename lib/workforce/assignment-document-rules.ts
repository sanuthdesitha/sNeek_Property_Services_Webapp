/**
 * Expired police check or visa on assignment (owner default 2026-11-16,
 * pending owner confirmation): it WARNS, like recorded leave, and the
 * assignment needs the explicit "Assign anyway" override. It never blocks
 * and does not change who may assign. Missing documents are not "expired":
 * only a recorded expiry before the job's day counts.
 *
 *   - Police check: the person's police-check documents that were not
 *     rejected; the one that runs latest decides. Expired when its expiry is
 *     before the job day, or it was marked EXPIRED. None on file: no warning
 *     here (that is a compliance gap, not an expiry).
 *   - Visa / right to work: User.visaExpiry before the job day.
 *
 * PURE: no DB, no I/O.
 */

export type PoliceCheckDocument = { status: string; expiresAt: Date | null };

export type DocumentWarningKind = "POLICE_CHECK" | "VISA";

export type AssignmentDocumentWarning = {
  userId: string;
  name: string;
  kind: DocumentWarningKind;
  reason: string;
  expiredOn: string;
};

const POLICE_CHECK_CATEGORY = "POLICE_CHECK";

export function isPoliceCheckCategory(category: string): boolean {
  return category.trim().toUpperCase() === POLICE_CHECK_CATEGORY;
}

function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readableDay(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${names[month - 1]} ${year}`;
}

/** The expiry day that decides the police check, or null when none is recorded. */
export function policeCheckExpiry(documents: readonly PoliceCheckDocument[]): { dayKey: string | null; markedExpired: boolean } | null {
  const usable = documents.filter((document) => document.status.toUpperCase() !== "REJECTED");
  if (usable.length === 0) return null;
  const dated = usable.filter((document) => document.expiresAt).sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime());
  const undatedCurrent = usable.some((document) => !document.expiresAt && document.status.toUpperCase() !== "EXPIRED");
  // A current check with no expiry (it never expires) outranks any dated one.
  if (undatedCurrent) return { dayKey: null, markedExpired: false };
  const latest = dated[0];
  if (!latest) return { dayKey: null, markedExpired: true };
  return { dayKey: dayKeyOf(latest.expiresAt!), markedExpired: latest.status.toUpperCase() === "EXPIRED" };
}

export function documentWarningsFor(
  person: { userId: string; name: string; visaExpiry: Date | null; policeChecks: readonly PoliceCheckDocument[] },
  jobDayKey: string,
): AssignmentDocumentWarning[] {
  const warnings: AssignmentDocumentWarning[] = [];
  const police = policeCheckExpiry(person.policeChecks);
  if (police && (police.markedExpired || (police.dayKey !== null && police.dayKey < jobDayKey))) {
    const on = police.dayKey ? readableDay(police.dayKey) : null;
    warnings.push({
      userId: person.userId,
      name: person.name,
      kind: "POLICE_CHECK",
      expiredOn: police.dayKey ?? "",
      reason: on ? `police check expired ${on}` : "police check marked expired",
    });
  }
  if (person.visaExpiry) {
    const visaDay = dayKeyOf(person.visaExpiry);
    if (visaDay < jobDayKey) {
      warnings.push({ userId: person.userId, name: person.name, kind: "VISA", expiredOn: visaDay, reason: `visa / right to work expired ${readableDay(visaDay)}` });
    }
  }
  return warnings;
}
