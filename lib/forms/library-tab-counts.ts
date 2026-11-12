import "server-only";
/** Real totals for the Forms library tab labels ("Job forms 18", "QA templates 6"). */
import { db } from "@/lib/db";

export async function getFormsTabCounts(include: { forms: boolean; qa: boolean }): Promise<{ forms: number | null; qa: number | null }> {
  const [forms, qa] = await Promise.all([
    include.forms ? db.formTemplate.count({ where: { archivedAt: null } }) : Promise.resolve(null),
    include.qa ? db.qaFormTemplate.count() : Promise.resolve(null),
  ]);
  return { forms, qa };
}
