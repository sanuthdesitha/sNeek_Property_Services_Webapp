/**
 * Pure QA-report data extraction — no db / server-only imports (S3 key→url is
 * dependency-injected) so it is unit-testable and reusable by the template
 * engine (doc.qaReport, rebrand doc 03 §4.2). Mirrors the field/damage/rework
 * semantics of lib/reports/qa-report.ts buildQaReportHtml.
 */

export interface QaReportData {
  report: {
    property: { name: string; suburb: string; jobType: string; date: string };
    meta: { cleaner: string; inspector: string; onSiteMinutes: string };
    qa: {
      score: number | null;
      passed: boolean | null;
      categories: Array<{ label: string; score: number }>;
      rework: { required: boolean; severity: string; areas: string[]; note: string } | null;
    } | null;
    hasQa: boolean;
    notes: string;
    sections: Array<{
      title: string;
      items: Array<{ label: string; checked?: boolean; value?: string }>;
    }>;
    findings: Array<{
      title: string;
      items: Array<{
        label: string;
        checked?: boolean;
        value?: string;
        note?: string;
        media?: Array<{ url: string; type: "PHOTO" | "VIDEO"; caption?: string }>;
      }>;
    }>;
    hasFindings: boolean;
    photos: Array<{ url: string; type: "PHOTO" | "VIDEO"; caption?: string }>;
  };
  actionUrl: string;
}

export interface QaReportExtractInput {
  job: any;
  submission: any;
  qa: any;
  tools: any;
  localDate: string;
  inspector: string;
  cleaners: string;
  onSiteMinutes: number | null;
  actionUrl?: string;
}

/** Format a QA field's answer the same way the legacy QA report does. */
function qaFieldValue(field: any, raw: unknown): string {
  if (field?.type === "checkbox") return raw === true ? "Yes" : "No";
  if (field?.type === "rating") {
    const max = Number(field.max ?? 5) || 5;
    return raw == null || raw === "" ? "-" : `${Number(raw)} / ${max}`;
  }
  return raw == null || raw === "" ? "-" : String(raw as string | number);
}

export function extractQaReportData(
  input: QaReportExtractInput,
  keyToUrl: (key: string) => string,
): QaReportData {
  const { job, submission, qa, tools, localDate, inspector, cleaners, onSiteMinutes } = input;
  const templateSchema: any = submission?.template?.schema ?? null;
  const schemaSections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const answers: Record<string, unknown> =
    submission?.data && typeof submission.data === "object" ? submission.data : {};
  const categoryScores: Record<string, number> =
    submission?.categoryScores && typeof submission.categoryScores === "object" ? submission.categoryScores : {};
  const sectionPhotos: Record<string, string[]> =
    tools?.sectionPhotos && typeof tools.sectionPhotos === "object" ? tools.sectionPhotos : {};

  // Per-section field results (value rows; checkboxes as pass/fail glyphs).
  const sections = schemaSections
    .map((section: any) => {
      const fields = (Array.isArray(section?.fields) ? section.fields : []).filter((f: any) => f?.type !== "upload");
      const items = fields.map((field: any) => {
        const raw = answers[field.id];
        const isCheckbox = field?.type === "checkbox";
        return {
          label: String(field.label ?? field.id ?? "-"),
          checked: isCheckbox ? raw === true : undefined,
          value: isCheckbox ? undefined : (() => {
            const v = qaFieldValue(field, raw);
            return v === "-" ? undefined : v;
          })(),
        };
      });
      return { title: String(section.label ?? section.title ?? "Section"), items };
    })
    .filter((s: any) => s.items.length > 0);

  // Damage findings → one "Damage findings" checklist section.
  const damageEntries = (Array.isArray(tools?.damage) ? tools.damage : []).filter(
    (d: any) => d && (d.area || d.description || (d.photoKeys ?? []).length),
  );
  const findings = damageEntries.length
    ? [
        {
          title: "Damage findings",
          items: damageEntries.map((d: any) => ({
            label: String(d.area || "Unspecified area"),
            checked: false,
            value: String(d.severity ?? ""),
            note: d.description ? String(d.description) : undefined,
            media: (Array.isArray(d.photoKeys) ? d.photoKeys : [])
              .filter((k: unknown): k is string => typeof k === "string" && Boolean(k))
              .map((k: string) => ({ url: keyToUrl(k), type: "PHOTO" as const })),
          })),
        },
      ]
    : [];

  // All inspector section photos → gallery.
  const photoKeys: string[] = [];
  for (const value of Object.values(sectionPhotos)) {
    if (Array.isArray(value)) for (const k of value) if (typeof k === "string" && k) photoKeys.push(k);
  }
  const photos = photoKeys.map((k) => ({ url: keyToUrl(k), type: "PHOTO" as const }));

  // Category breakdown (label from the QA template section, else the id).
  const sectionLabels: Record<string, string> = {};
  for (const s of schemaSections) if (s?.id) sectionLabels[String(s.id)] = String(s.label ?? s.title ?? s.id);
  const categories = Object.entries(categoryScores)
    .filter(([, v]) => typeof v === "number")
    .map(([id, v]) => ({ label: sectionLabels[id] ?? id, score: Number(v) }));

  const score = qa?.score ?? submission?.score ?? null;
  const passed = qa?.passed ?? submission?.passed ?? null;
  const notes = String(qa?.notes ?? submission?.notes ?? "").trim();

  const rework =
    tools?.rework && tools.rework.enabled
      ? {
          required: true,
          severity: String(tools.rework.severity ?? "Rework"),
          areas: Array.isArray(tools.rework.areas) ? tools.rework.areas.map(String) : [],
          note: String(tools.rework.reason ?? ""),
        }
      : null;

  const hasQa = score != null || passed != null || categories.length > 0 || Boolean(rework);

  return {
    report: {
      property: {
        name: String(job?.property?.name ?? ""),
        suburb: String(job?.property?.suburb ?? ""),
        jobType: String(job?.jobType ?? "").replace(/_/g, " "),
        date: localDate,
      },
      meta: {
        cleaner: cleaners || "N/A",
        inspector: inspector || "QA inspector",
        onSiteMinutes: onSiteMinutes != null ? `${onSiteMinutes} min` : "—",
      },
      qa: hasQa ? { score: score != null ? Number(score) : null, passed, categories, rework } : null,
      hasQa,
      notes,
      sections,
      findings,
      hasFindings: findings.length > 0,
      photos,
    },
    actionUrl: input.actionUrl ?? "",
  };
}
