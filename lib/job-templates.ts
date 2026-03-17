import { JobType } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

const jobTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  jobType: z.nativeEnum(JobType),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  estimatedHours: z.number().positive().optional(),
  notes: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
  createdAt: z.string().datetime(),
});

export type JobTemplateConfig = z.infer<typeof jobTemplateSchema>;

function sanitizeTemplates(input: unknown): JobTemplateConfig[] {
  if (!Array.isArray(input)) return [];
  const parsed = input
    .map((item) => {
      const result = jobTemplateSchema.safeParse(item);
      return result.success ? result.data : null;
    })
    .filter((item): item is JobTemplateConfig => Boolean(item));
  return parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJobTemplates(): Promise<JobTemplateConfig[]> {
  const row = await db.appSetting.findUnique({ where: { key: "jobTemplates" } });
  if (!row) return [];
  return sanitizeTemplates(row.value);
}

export async function saveJobTemplates(templates: JobTemplateConfig[]): Promise<JobTemplateConfig[]> {
  const clean = sanitizeTemplates(templates);
  await db.appSetting.upsert({
    where: { key: "jobTemplates" },
    create: { key: "jobTemplates", value: clean as any },
    update: { value: clean as any },
  });
  return clean;
}
