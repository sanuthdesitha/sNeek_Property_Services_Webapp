import "server-only";
/** Real totals for the Forms library tab labels ("Job forms 18", "QA templates 6"). */
import { db } from "@/lib/db";

export async function getFormsTabCounts(include: { forms: boolean; qa: boolean; messages?: boolean }): Promise<{ forms: number | null; qa: number | null; messages: number | null }> {
  const [forms, qa, messages] = await Promise.all([
    include.forms ? db.formTemplate.count({ where: { archivedAt: null } }) : Promise.resolve(null),
    include.qa ? db.qaFormTemplate.count() : Promise.resolve(null),
    // "Message templates 21" on the Message templates chip; null (no number) when it cannot be read.
    include.messages ? db.messageTemplate.count().catch(() => null) : Promise.resolve(null),
  ]);
  return { forms, qa, messages };
}
