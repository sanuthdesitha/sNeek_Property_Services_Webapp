import "server-only";
/**
 * Loader for the expired police check / visa warning on assignment (rules in
 * ./assignment-document-rules). Used by the assign, bulk-assign and calendar
 * move checks beside the leave conflicts, with the same "Assign anyway"
 * override; it adds a warning and never removes a permission.
 */
import { db } from "@/lib/db";
import { documentWarningsFor, isPoliceCheckCategory, type AssignmentDocumentWarning } from "./assignment-document-rules";

export type { AssignmentDocumentWarning } from "./assignment-document-rules";

export async function assignmentDocumentWarnings(userIds: readonly string[], scheduledDate: Date): Promise<AssignmentDocumentWarning[]> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const jobDayKey = scheduledDate.toISOString().slice(0, 10);
  const [people, documents] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, visaExpiry: true } }),
    db.staffDocument.findMany({
      where: { userId: { in: ids }, category: { equals: "POLICE_CHECK", mode: "insensitive" } },
      select: { userId: true, category: true, status: true, expiresAt: true },
    }),
  ]);
  const byUser = new Map<string, Array<{ status: string; expiresAt: Date | null }>>();
  for (const document of documents) {
    if (!isPoliceCheckCategory(document.category)) continue;
    const list = byUser.get(document.userId) ?? [];
    list.push({ status: document.status, expiresAt: document.expiresAt });
    byUser.set(document.userId, list);
  }
  return ids.flatMap((id) => {
    const person = people.find((row) => row.id === id);
    if (!person) return [];
    return documentWarningsFor(
      { userId: id, name: person.name?.trim() || person.email || "Cleaner", visaExpiry: person.visaExpiry, policeChecks: byUser.get(id) ?? [] },
      jobDayKey,
    );
  });
}
