import { formatInTimeZone } from "date-fns-tz";
const TZ = "Australia/Sydney";
export type CadenceEvidenceJob = {
  id: string; jobType: string; status: string; completedAt: Date | string | null;
  formSubmissions: Array<{ data: unknown; media: Array<{ s3Key: string | null }> }>;
  jobTasks: Array<{ title: string; executionStatus: string; attachments: Array<{ kind: string; s3Key: string | null }> }>;
};
const definitions = [
  { key: "deep_clean", label: "Deep clean", cadence: "QUARTERLY" },
  { key: "skirting", label: "Skirting", cadence: "WEEKLY" },
  { key: "cobweb", label: "Cobwebs", cadence: "WEEKLY" },
  { key: "detail", label: "Detail extras", cadence: "WEEKLY" },
] as const;
export function addCalendarMonths(day: string, months: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}
export function sydneyWeekStart(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function nextWeek(day: string): string {
  const date = new Date(`${sydneyWeekStart(day)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}
function matches(key: string, text: string): boolean {
  return key === "deep_clean" ? /\bdeep[\s_.-]*clean\b/i.test(text)
    : key === "skirting" ? /skirting/i.test(text)
    : key === "cobweb" ? /cobweb/i.test(text)
    : /\bdetail\b|rot[_ .-]|rotational/i.test(text);
}
/** Review-only evidence index. Matches are candidates, not a certification that
 * one photo proves every room/task in a property was serviced. */
export function buildCadenceLedger(jobs: CadenceEvidenceJob[], now = new Date()) {
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  return definitions.map((definition) => {
    let latest: { day: string; jobId: string; basis: string } | null = null;
    for (const job of jobs) {
      if (!["COMPLETED", "INVOICED"].includes(job.status) || !job.completedAt) continue;
      const completed = new Date(job.completedAt);
      if (!Number.isFinite(completed.getTime()) || completed > now) continue;
      const day = formatInTimeZone(completed, TZ, "yyyy-MM-dd");
      if (latest && day <= latest.day) continue;
      let basis: string | null = null;
      if (definition.key === "deep_clean" && job.jobType === "DEEP_CLEAN" && job.formSubmissions.some(s => s.media.some(media => Boolean(media.s3Key)))) {
        basis = "Completed deep-clean job with submitted media";
      }
      for (const task of job.jobTasks) {
        if (task.executionStatus === "COMPLETED" && matches(definition.key, task.title) && task.attachments.some(a => a.kind === "COMPLETION_PROOF" && Boolean(a.s3Key))) basis = `Completed Scope task: ${task.title}`;
      }
      for (const submission of job.formSubmissions) {
        const data = submission.data as any;
        const mediaKeys = new Set(submission.media.map(m => m.s3Key).filter(Boolean));
        const inspect = (field: any) => {
          const proof = data?.uploads?.[field?.id];
          const keys = typeof proof === "string" ? [proof] : Array.isArray(proof) ? proof : [];
          if (matches(definition.key, `${field?.id ?? ""} ${field?.label ?? ""}`) && keys.some((key: string) => mediaKeys.has(key))) basis = `Checklist photo: ${field.label ?? field.id}`;
          if (Array.isArray(field?.children)) field.children.forEach(inspect);
        };
        for (const section of data?.__templateSchema?.sections ?? []) for (const field of section.fields ?? []) inspect(field);
      }
      if (basis) latest = { day, jobId: job.id, basis };
    }
    const dueDay = latest ? definition.cadence === "QUARTERLY" ? addCalendarMonths(latest.day, 3) : nextWeek(latest.day) : null;
    const comparisonDay = definition.cadence === "WEEKLY" ? sydneyWeekStart(today) : today;
    const status = !dueDay ? "UNVERIFIED" : comparisonDay > dueDay ? "OVERDUE" : comparisonDay === dueDay ? "DUE" : "CURRENT";
    return { ...definition, lastEvidence: latest, dueDay, status };
  });
}
