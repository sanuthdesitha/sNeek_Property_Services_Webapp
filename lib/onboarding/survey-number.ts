import { db } from "@/lib/db";

export async function generateSurveyNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ONB-${year}-`;

  const lastSurvey = await db.propertyOnboardingSurvey.findFirst({
    where: { surveyNumber: { startsWith: prefix } },
    orderBy: { surveyNumber: "desc" },
    select: { surveyNumber: true },
  });

  const lastNum = lastSurvey ? parseInt(lastSurvey.surveyNumber.split("-").pop() ?? "0", 10) : 0;
  const nextNum = lastNum + 1;
  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}
