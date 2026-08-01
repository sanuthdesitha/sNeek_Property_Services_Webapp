import { db } from "@/lib/db";
import { getPresignedDownloadUrl, publicUrl, s3 } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { QA_TOOLS_DATA_KEY, type QaInspectionTools } from "@/lib/qa/inspection-tools";
import { normalizeQaPhotoRefs, displayKeyFor } from "@/lib/qa/annotation-composite";

/**
 * The Quality Inspection Report.
 *
 * Two audiences, one builder:
 *
 *   INTERNAL     — admin / QA. Everything: damage cost estimates, rework pay
 *                  movements, the inspector's private notes.
 *   CLEANER-SAFE — the cleaner who did the work. What was wrong, where, with
 *                  photos and the score breakdown so the marks are explicable.
 *                  Money and blame-adjacent internals are stripped IN THE DATA,
 *                  never merely hidden with CSS.
 *
 * Three defects this replaces, all of which made the downloaded report close to
 * useless:
 *
 *  1. NO PICTURES. The query pulled neither the cleaner's submission media nor
 *     the per-item `QaIssue` rows — and in the accountability flow the
 *     inspector's primary photo capture IS per-item. An inspection graded purely
 *     with verdicts therefore rendered literally zero images.
 *  2. BROKEN IMAGE URLS. It built URLs with `publicUrl()`, i.e. a bare
 *     `${S3_PUBLIC_BASE_URL}/key`, or a RELATIVE path when that env var is
 *     unset. The PDF renders via `page.setContent()` on `about:blank`, where a
 *     relative URL resolves to nothing. Every other QA surface presigns, which
 *     tells you the bucket is private. We presign here too.
 *  3. BLACK SIGNATURE. A remote transparent PNG hit the PDF image interceptor
 *     and was flattened to JPEG onto black. The signature is now inlined as a
 *     base64 data URL, which that interceptor deliberately skips.
 */

const TZ = "Australia/Sydney";

/** Cache-bust marker, mirroring lib/reports/generator.ts. */
export const QA_REPORT_TEMPLATE_VERSION = "qa-v2-estate";

export type QaReportMode = "internal" | "cleanerSafe";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolve every S3 key the report needs to a URL the renderer can actually
 * fetch, in one pass, before any HTML is built.
 *
 * Presigning is async and the template is not, so the keys are collected first
 * and looked up through this map afterwards. A key that fails to sign falls back
 * to `publicUrl` rather than breaking the whole report.
 */
async function buildUrlMap(keys: Iterable<string>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(Array.from(keys).filter((k) => typeof k === "string" && k.trim())));
  const entries = await Promise.all(
    unique.map(async (key) => {
      try {
        return [key, await getPresignedDownloadUrl(key, 3600)] as const;
      } catch {
        return [key, publicUrl(key)] as const;
      }
    })
  );
  return new Map(entries);
}

/**
 * Inline an image as a base64 data URL.
 *
 * `lib/reports/pdf.ts` skips `data:` URLs in its image interceptor, so this is
 * the one reliable way to keep a transparent PNG transparent in the PDF. Used
 * for the signature, which is exactly that.
 */
async function inlineImage(key: string): Promise<string | null> {
  try {
    const res = await s3.getObject({ Bucket: process.env.S3_BUCKET_NAME!, Key: key }).promise();
    const body: any = res.Body;
    if (!body) return null;
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const type = (res.ContentType as string) || "image/png";
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function readQaTools(data: unknown): QaInspectionTools | null {
  if (!data || typeof data !== "object") return null;
  const tools = (data as Record<string, unknown>)[QA_TOOLS_DATA_KEY];
  if (!tools || typeof tools !== "object") return null;
  return tools as QaInspectionTools;
}

const DAMAGE_TINT: Record<string, string> = {
  LOW: "#fef9c3",
  MEDIUM: "#fed7aa",
  HIGH: "#fecaca",
  CRITICAL: "#fca5a5",
};

const SEVERITY_TINT: Record<string, { bg: string; ink: string }> = {
  MINOR: { bg: "#fef3c7", ink: "#92400e" },
  MAJOR: { bg: "#fed7aa", ink: "#9a3412" },
  CRITICAL: { bg: "#fecaca", ink: "#991b1b" },
};

const RATING_LABEL: Record<string, string> = {
  EXCELLENT: "Excellent",
  PASS: "Pass",
  NEEDS_IMPROVEMENT: "Needs improvement",
  FAILED: "Failed",
  MANAGEMENT_REVIEW: "Management review",
};

function titleCase(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * A grid of photos.
 *
 * Renders ONE opaque image per photo and never CSS-stacks an annotation
 * overlay. Stacking works in a browser but the PDF re-encodes images to JPEG,
 * which has no alpha — the transparent overlay became a solid black square
 * covering the photo, so every annotated QA photo in every downloaded report
 * was a black tile. Annotations are flattened server-side at submit time
 * (lib/qa/annotation-composite.ts) and we show the composite.
 */
function photoGridHtml(
  keys: string[],
  urls: Map<string, string>,
  opts: {
    size?: number;
    annotations?: Record<string, { overlayKey?: string; comment?: string; flatKey?: string }>;
    captionOf?: (key: string) => string | null;
  } = {}
): string {
  if (!keys.length) return "";
  const size = opts.size ?? 150;
  const items = keys
    .map((key) => {
      const ann = opts.annotations?.[key];
      const shownKey = ann?.flatKey || key;
      const url = urls.get(shownKey);
      if (!url) return "";
      const marked = Boolean(ann?.flatKey);
      const caption = ann?.comment ?? opts.captionOf?.(key) ?? null;
      return `<figure class="qa-photo" style="width:${size}px;">
        <div class="qa-photo-frame" style="width:${size}px;height:${size}px;">
          <img src="${escapeHtml(url)}" alt="QA photo" style="width:${size}px;height:${size}px;" />
          ${marked ? `<span class="qa-photo-tag">QA markup</span>` : ""}
        </div>
        ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
      </figure>`;
    })
    .join("");
  return items ? `<div class="qa-photo-grid">${items}</div>` : "";
}

export interface BuildQaReportOptions {
  /** Defaults to the full internal report. */
  mode?: QaReportMode;
}

/** Build the standalone Quality Inspection Report HTML for a job. */
export async function buildQaReportHtml(
  jobId: string,
  options: BuildQaReportOptions = {}
): Promise<{ html: string; jobNumber: string } | null> {
  const mode: QaReportMode = options.mode ?? "internal";
  const internal = mode === "internal";

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      property: { include: { client: true } },
      assignments: { where: { removedAt: null }, include: { user: { select: { name: true, email: true } } } },
      qaReviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { reviewedBy: { select: { name: true, email: true } } },
      },
      // The per-item verdicts. In the accountability flow this is where the
      // inspector's evidence actually lives — omitting it is why an inspection
      // could render with no images at all.
      qaIssues: {
        orderBy: { createdAt: "asc" },
        include: { cleaner: { select: { name: true } } },
      },
      // The cleaner's own submitted evidence, so the report shows what was
      // claimed beside what was found.
      formSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { media: { orderBy: { createdAt: "asc" } } },
      },
      qaFormSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          template: true,
          submittedBy: { select: { name: true, email: true } },
          assignment: {
            include: { assignedTo: { select: { name: true } }, pickedUpBy: { select: { name: true } } },
          },
        },
      },
    },
  });

  if (!job) return null;

  const submission = job.qaFormSubmissions[0];
  const qa = job.qaReviews[0];
  const tools = readQaTools(submission?.data);
  const settings = await getAppSettings();
  const localDate = format(toZonedTime(job.scheduledDate, TZ), "dd MMMM yyyy");
  const companyName = settings?.companyName || "sNeek Property Services";
  const logoUrl = settings?.logoUrl?.trim() || settings?.reportLogoUrl?.trim() || "";
  const categoryLabels = new Map(
    (settings?.accountability?.issueCategories ?? []).map((c) => [c.key, c.label])
  );

  const templateSchema: any = submission?.template?.schema ?? null;
  const answers: Record<string, unknown> =
    submission?.data && typeof submission.data === "object" ? (submission.data as Record<string, unknown>) : {};
  const categoryScores: Record<string, number> =
    submission?.categoryScores && typeof submission.categoryScores === "object"
      ? (submission.categoryScores as Record<string, number>)
      : {};

  const inspector =
    submission?.assignment?.assignedTo?.name ||
    submission?.assignment?.pickedUpBy?.name ||
    qa?.reviewedBy?.name ||
    submission?.submittedBy?.name ||
    "QA inspector";
  const onSiteMinutes = tools?.onSite?.minutes ?? submission?.assignment?.onSiteMinutes ?? null;
  const cleaners = job.assignments.map((a) => a.user?.name || a.user?.email).filter(Boolean).join(", ") || "N/A";
  const sectionPhotos: Record<string, string[]> = tools?.sectionPhotos ?? {};
  const issues = job.qaIssues ?? [];
  const cleanerMedia = (job.formSubmissions[0]?.media ?? []).filter(
    (m: any) => String(m.kind ?? "IMAGE").toUpperCase() === "IMAGE"
  );

  // ── Collect EVERY key first, then presign in one pass ──────────────────────
  const keys = new Set<string>();
  for (const list of Object.values(sectionPhotos)) for (const k of list ?? []) keys.add(k);
  for (const [orig, ann] of Object.entries(tools?.mediaAnnotations ?? {})) {
    keys.add((ann?.flatKey as string) || orig);
  }
  for (const d of tools?.damage ?? []) {
    for (const k of d.photoKeys ?? []) keys.add((d.annotations?.[k]?.flatKey as string) || k);
  }
  for (const area of tools?.rework?.flaggedAreas ?? []) {
    for (const k of area.photoKeys ?? []) keys.add((area.annotations?.[k]?.flatKey as string) || k);
  }
  for (const issue of issues) {
    for (const ref of normalizeQaPhotoRefs(issue.qaPhotoKeys)) keys.add(displayKeyFor(ref));
  }
  for (const m of cleanerMedia) if (m.s3Key) keys.add(m.s3Key);
  const urls = await buildUrlMap(keys);

  // ── Score breakdown ────────────────────────────────────────────────────────
  const score = qa?.score ?? submission?.score ?? null;
  const passed = qa?.passed ?? submission?.passed ?? null;
  const rating = qa?.rating ?? null;
  const counts = issues.reduce(
    (acc, i) => {
      const key = String(i.severity) as "MINOR" | "MAJOR" | "CRITICAL";
      if (key in acc) acc[key] += 1;
      return acc;
    },
    { MINOR: 0, MAJOR: 0, CRITICAL: 0 }
  );
  const deductions = settings.accountability?.scoring ?? null;
  // Deduction values are SETTINGS-driven; quoting hardcoded 3/10/25 would be a
  // lie the moment an admin retunes them.
  const breakdownRows = [
    { label: "Minor issues", count: counts.MINOR, each: deductions?.minorDeduction ?? null },
    { label: "Major issues", count: counts.MAJOR, each: deductions?.majorDeduction ?? null },
    { label: "Critical issues", count: counts.CRITICAL, each: deductions?.criticalDeduction ?? null },
  ].filter((r) => r.count > 0);

  const breakdownHtml = breakdownRows.length
    ? `<table class="qa-table">
        <tr><th>Finding</th><th>Count</th><th>Each</th><th>Total</th></tr>
        ${breakdownRows
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.label)}</td>
              <td class="num">${r.count}</td>
              <td class="num">${r.each != null ? `−${escapeHtml(r.each)}` : "—"}</td>
              <td class="num">${r.each != null ? `−${escapeHtml(r.count * r.each)}` : "—"}</td>
            </tr>`
          )
          .join("")}
      </table>`
    : `<p class="qa-muted">No issues were raised against this clean.</p>`;

  // ── Per-item issues (the inspector's actual findings + evidence) ────────────
  const issuesHtml = issues
    .map((issue) => {
      const tint = SEVERITY_TINT[String(issue.severity)] ?? SEVERITY_TINT.MINOR;
      const refs = normalizeQaPhotoRefs(issue.qaPhotoKeys);
      const photoKeys = refs.map((r) => displayKeyFor(r));
      const annotations: Record<string, { flatKey?: string; comment?: string }> = {};
      for (const r of refs) {
        annotations[displayKeyFor(r)] = {
          flatKey: r.flatKey ? displayKeyFor(r) : undefined,
          comment: r.comment ?? undefined,
        };
      }
      const categoryLabel = categoryLabels.get(issue.category) ?? titleCase(issue.category);
      return `<div class="qa-card qa-issue">
        <div class="qa-issue-head">
          <span class="qa-chip" style="background:${tint.bg};color:${tint.ink};">${escapeHtml(issue.severity)}</span>
          <strong>${escapeHtml(categoryLabel)}</strong>
          ${issue.guestReadyImpact ? `<span class="qa-chip qa-chip-warn">Guest-ready impact</span>` : ""}
          ${
            internal && issue.falseConfirmation && issue.falseConfirmation !== "NONE"
              ? `<span class="qa-chip qa-chip-danger">False confirmation: ${escapeHtml(titleCase(issue.falseConfirmation))}</span>`
              : ""
          }
        </div>
        <p class="qa-body">${escapeHtml(issue.description)}</p>
        ${
          issue.cleanerMarkedComplete
            ? `<p class="qa-note">This item had been marked complete on the cleaning checklist.</p>`
            : ""
        }
        ${photoGridHtml(photoKeys, urls, { annotations, size: 160 })}
      </div>`;
    })
    .join("");

  // ── Per-section checklist results ─────────────────────────────────────────
  const sectionsHtml = (Array.isArray(templateSchema?.sections) ? templateSchema.sections : [])
    .map((section: any) => {
      const fields = Array.isArray(section?.fields) ? section.fields : [];
      const rows = fields
        .filter((f: any) => f?.type !== "upload")
        .map((field: any) => {
          const raw = answers[field.id];
          let valueText = "-";
          if (field.type === "checkbox") valueText = raw === true ? "Yes" : "No";
          else if (field.type === "rating") {
            const max = Number(field.max ?? 5) || 5;
            valueText = raw == null || raw === "" ? "-" : `${Number(raw)} / ${max}`;
          } else valueText = raw == null || raw === "" ? "-" : String(raw);
          return `<tr><td>${escapeHtml(field.label ?? field.id)}</td><td class="strong">${escapeHtml(valueText)}</td></tr>`;
        })
        .join("");
      const cat = categoryScores[section.id];
      const photos = (sectionPhotos[section.id] ?? []).map(
        (k) => (tools?.mediaAnnotations?.[k]?.flatKey as string) || k
      );
      const annotations: Record<string, { flatKey?: string; comment?: string }> = {};
      for (const original of sectionPhotos[section.id] ?? []) {
        const ann = tools?.mediaAnnotations?.[original];
        const shown = (ann?.flatKey as string) || original;
        if (ann) annotations[shown] = { flatKey: ann.flatKey, comment: ann.comment };
      }
      return `<div class="qa-section">
          <div class="qa-section-head">
            <h3>${escapeHtml(section.label ?? "Section")}</h3>
            ${typeof cat === "number" ? `<span class="qa-muted">Section score: <strong>${cat}%</strong></span>` : ""}
          </div>
          <table class="qa-table">${rows || `<tr><td class="qa-muted">No fields captured.</td></tr>`}</table>
          ${photos.length ? `<p class="qa-muted qa-label">Inspector photos (${photos.length})</p>${photoGridHtml(photos, urls, { annotations })}` : ""}
        </div>`;
    })
    .join("");

  // ── Cleaner's own evidence ─────────────────────────────────────────────────
  const cleanerMediaHtml = cleanerMedia.length
    ? photoGridHtml(
        cleanerMedia.map((m: any) => m.s3Key).filter(Boolean),
        urls,
        { size: 120 }
      )
    : "";

  // ── Damage findings ────────────────────────────────────────────────────────
  const damageHtml = (tools?.damage ?? [])
    .filter((d) => d.area || d.description || (d.photoKeys ?? []).length)
    .map((d) => {
      const tint = DAMAGE_TINT[d.severity] ?? "#fde68a";
      const shownKeys = (d.photoKeys ?? []).map((k) => (d.annotations?.[k]?.flatKey as string) || k);
      const annotations: Record<string, { flatKey?: string; comment?: string }> = {};
      for (const original of d.photoKeys ?? []) {
        const ann = d.annotations?.[original];
        const shown = (ann?.flatKey as string) || original;
        if (ann) annotations[shown] = { flatKey: ann.flatKey, comment: ann.comment };
      }
      return `<div class="qa-card" style="border-left:4px solid ${tint};">
          <div class="qa-issue-head">
            <strong>${escapeHtml(d.area || "Unspecified area")}</strong>
            <span class="qa-chip" style="background:${tint};color:#7c2d12;">${escapeHtml(d.severity)}</span>
            ${
              // Cost estimates are an internal commercial matter, not something a
              // cleaner should read off their own inspection report.
              internal && d.estimatedCost != null
                ? `<span class="qa-muted" style="margin-left:auto;">Est. cost: <strong>$${escapeHtml(Number(d.estimatedCost).toFixed(2))}</strong></span>`
                : ""
            }
          </div>
          ${d.description ? `<p class="qa-body">${escapeHtml(d.description)}</p>` : ""}
          ${photoGridHtml(shownKeys, urls, { annotations })}
        </div>`;
    })
    .join("");

  // ── Rework flagged areas (previously dropped entirely) ─────────────────────
  const rework = tools?.rework;
  const flaggedHtml = (rework?.flaggedAreas ?? [])
    .map((area) => {
      const shownKeys = (area.photoKeys ?? []).map((k) => (area.annotations?.[k]?.flatKey as string) || k);
      const annotations: Record<string, { flatKey?: string; comment?: string }> = {};
      for (const original of area.photoKeys ?? []) {
        const ann = area.annotations?.[original];
        const shown = (ann?.flatKey as string) || original;
        if (ann) annotations[shown] = { flatKey: ann.flatKey, comment: ann.comment };
      }
      return `<div class="qa-card">
        <strong>${escapeHtml(area.label)}</strong>
        ${area.note ? `<p class="qa-body">${escapeHtml(area.note)}</p>` : ""}
        ${photoGridHtml(shownKeys, urls, { annotations })}
      </div>`;
    })
    .join("");

  const reworkHtml =
    rework && rework.enabled
      ? `<div class="qa-card">
          <p class="qa-body"><strong>${escapeHtml(rework.severity)}</strong> — ${escapeHtml(rework.reason || "—")}</p>
          ${rework.areas?.length ? `<p class="qa-muted">Areas redone: ${escapeHtml(rework.areas.join(", "))}</p>` : ""}
          ${
            // Pay movement between staff is internal.
            internal
              ? `<p class="qa-muted">Time reassigned: ${escapeHtml(rework.minutesFromCleaner)} min · Amount: $${escapeHtml(Number(rework.amountFromCleaner ?? 0).toFixed(2))}</p>`
              : ""
          }
        </div>${flaggedHtml}`
      : flaggedHtml;

  // ── Attendance / on-site evidence ──────────────────────────────────────────
  const assignment = submission?.assignment;
  const checkInLabel = assignment?.checkInAt
    ? format(toZonedTime(assignment.checkInAt, TZ), "dd MMM yyyy, h:mm a")
    : null;
  const attendanceHtml = `<div class="qa-card">
      <table class="qa-table">
        <tr><td>Inspector on-site check-in</td><td class="strong">${
          checkInLabel
            ? escapeHtml(checkInLabel)
            : assignment?.checkInSkippedReason
              ? `Remote review — ${escapeHtml(assignment.checkInSkippedReason)}`
              : "Not recorded"
        }</td></tr>
        <tr><td>Time on site</td><td class="strong">${onSiteMinutes != null ? `${escapeHtml(onSiteMinutes)} min` : "—"}</td></tr>
        <tr><td>Cleaner clock-in GPS</td><td class="strong">${
          job.gpsCheckInAt
            ? `${escapeHtml(format(toZonedTime(job.gpsCheckInAt, TZ), "dd MMM yyyy, h:mm a"))}${
                job.gpsDistanceMeters != null
                  ? ` · ${escapeHtml(Math.round(Number(job.gpsDistanceMeters)))} m from property`
                  : ""
              }`
            : "Not recorded"
        }</td></tr>
      </table>
    </div>`;

  const notes = (qa?.notes ?? submission?.notes ?? "").toString();

  // ── Inspector sign-off ─────────────────────────────────────────────────────
  const signOff = tools?.signOff ?? null;
  const signedAtLabel =
    signOff?.signedAt && Number.isFinite(new Date(signOff.signedAt).getTime())
      ? format(toZonedTime(new Date(signOff.signedAt), TZ), "dd MMM yyyy, h:mm a")
      : "";
  // Inlined as a data URL: the PDF image interceptor skips `data:`, so the
  // transparent signature PNG is never flattened onto black.
  const signatureDataUrl = signOff?.signatureKey ? await inlineImage(signOff.signatureKey) : null;
  const signOffHtml = signatureDataUrl
    ? `<h2>Inspector sign-off</h2>
        <div class="qa-card qa-signoff">
          <div>
            <img src="${signatureDataUrl}" alt="Inspector signature" class="qa-signature" />
            <p class="qa-muted"><strong>${escapeHtml(signOff?.signedByName || inspector)}</strong>${signedAtLabel ? ` · ${escapeHtml(signedAtLabel)}` : ""}</p>
          </div>
          ${signOff?.attested ? `<p class="qa-body qa-attest">&#10003; The inspector attested that this QA inspection is accurate and complete, and was carried out by them.</p>` : ""}
        </div>`
    : "";

  const ratingLabel = rating ? RATING_LABEL[rating] ?? titleCase(rating) : null;

  const html = `<!DOCTYPE html>
<!-- report-template:${QA_REPORT_TEMPLATE_VERSION} mode:${mode} -->
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Quality Inspection Report — ${escapeHtml(job.jobNumber ?? job.id)}</title>
<style>
  /* Estate report skin — deep slate + gold, matching lib/reports/estate-template.ts */
  :root {
    --ink: #10221c; --ink-soft: #40514b; --muted: #7c8b85;
    --line: #e4e9e6; --gold: #a8874e; --surface: #ffffff; --raised: #f7f9f8;
  }
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Segoe UI", Helvetica, Arial, sans-serif;
    color: var(--ink); max-width: 900px; margin: 0 auto; padding: 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  /* Cards and photos must never be split down the middle by a page break. */
  .qa-card, .qa-section, figure.qa-photo, .qa-signoff { break-inside: avoid; page-break-inside: avoid; }
  h2 { break-after: avoid; page-break-after: avoid; }

  .qa-cover { background: var(--ink); color: #fff; border-radius: 16px; padding: 28px 30px; margin-bottom: 22px; }
  .qa-cover .eyebrow { font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: var(--gold); margin: 0 0 8px; }
  .qa-cover h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -.01em; }
  .qa-cover p { margin: 6px 0 0; font-size: 13px; color: #c9d4cf; }
  .qa-cover img { max-width: 170px; max-height: 46px; object-fit: contain; margin-bottom: 14px; }

  .qa-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 22px; }
  .qa-tile { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--raised); }
  .qa-tile .k { font-size: 9.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
  .qa-tile .v { font-size: 15px; font-weight: 600; margin-top: 3px; }

  .qa-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px;
    background: var(--raised); border: 1px solid var(--line); border-radius: 14px; padding: 18px; margin-bottom: 22px; }
  .qa-summary .k { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
  .qa-summary .v { font-size: 14px; font-weight: 600; margin-top: 2px; }

  .badge { display: inline-block; padding: 5px 14px; border-radius: 9999px; font-size: 13px; font-weight: 700; }
  .pass { background: #dcfce7; color: #15803d; }
  .fail { background: #fee2e2; color: #b91c1c; }

  h2 { font-size: 15px; letter-spacing: .01em; margin: 28px 0 12px; padding-bottom: 7px;
       border-bottom: 1px solid var(--line); color: var(--ink); }
  h3 { font-size: 14px; margin: 0 0 8px; }

  .qa-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin: 0 0 12px; background: var(--surface); }
  .qa-section { margin: 0 0 18px; }
  .qa-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .qa-issue-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .qa-body { margin: 8px 0 0; font-size: 13px; color: var(--ink-soft); white-space: pre-wrap; }
  .qa-note { margin: 6px 0 0; font-size: 11.5px; color: #b45309; }
  .qa-muted { font-size: 11.5px; color: var(--muted); }
  .qa-label { margin: 10px 0 0; }
  .qa-chip { display: inline-block; padding: 2px 9px; border-radius: 9999px; font-size: 10.5px; font-weight: 700; }
  .qa-chip-warn { background: #fef3c7; color: #92400e; }
  .qa-chip-danger { background: #fee2e2; color: #b91c1c; }

  .qa-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .qa-table th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    color: var(--muted); padding: 6px 10px; border-bottom: 1px solid var(--line); }
  .qa-table td { padding: 7px 10px; border-bottom: 1px solid #eef2f0; color: var(--ink-soft); vertical-align: top; }
  .qa-table td.strong { font-weight: 600; color: var(--ink); }
  .qa-table td.num { text-align: right; font-variant-numeric: tabular-nums; }

  .qa-photo-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; align-items: flex-start; }
  figure.qa-photo { margin: 0; }
  .qa-photo-frame { position: relative; overflow: hidden; border-radius: 10px; border: 1px solid var(--line); }
  .qa-photo-frame img { object-fit: cover; display: block; }
  .qa-photo-tag { position: absolute; left: 6px; top: 6px; background: #b91c1c; color: #fff;
    font-size: 9px; line-height: 1; padding: 3px 5px; border-radius: 6px; }
  figure.qa-photo figcaption { margin-top: 4px; font-size: 10px; line-height: 1.3; color: #b91c1c; }

  .qa-signoff { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; }
  /* White backstop: a transparent signature must read as ink on paper. */
  .qa-signature { height: 80px; max-width: 260px; object-fit: contain; background: #fff;
    padding: 6px 8px; border-radius: 8px; border-bottom: 1px solid #cbd5e1; }
  .qa-attest { flex: 1 1 220px; min-width: 200px; }
  ul { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--ink-soft); }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 4px; font-size: 11.5px; }
  footer { margin-top: 34px; font-size: 10px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 12px; }
</style>
</head>
<body>
  <section class="qa-cover">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)} logo" />` : ""}
    <p class="eyebrow">${internal ? "Quality assurance · Internal" : "Quality assurance · Your inspection"}</p>
    <h1>Quality Inspection Report</h1>
    <p>${escapeHtml(job.property?.name ?? "Property")} · ${escapeHtml(localDate)} · ${escapeHtml(companyName)}</p>
  </section>

  <div class="qa-tiles">
    <div class="qa-tile"><div class="k">Result</div><div class="v">${
      score != null
        ? `<span class="badge ${passed ? "pass" : "fail"}">${Number(score).toFixed(0)}%</span>`
        : "—"
    }</div></div>
    <div class="qa-tile"><div class="k">Rating</div><div class="v">${escapeHtml(ratingLabel ?? (passed == null ? "—" : passed ? "Passed" : "Failed"))}</div></div>
    <div class="qa-tile"><div class="k">Issues raised</div><div class="v">${issues.length}</div></div>
    <div class="qa-tile"><div class="k">Time on site</div><div class="v">${onSiteMinutes != null ? `${escapeHtml(onSiteMinutes)} min` : "—"}</div></div>
  </div>

  <div class="qa-summary">
    <div><div class="k">Property</div><div class="v">${escapeHtml(job.property?.name ?? "Property")}</div></div>
    <div><div class="k">Job number</div><div class="v">${escapeHtml(job.jobNumber ?? job.id)}</div></div>
    <div><div class="k">Address</div><div class="v">${escapeHtml(`${job.property?.address ?? ""}${job.property?.suburb ? `, ${job.property.suburb}` : ""}`)}</div></div>
    <div><div class="k">Date</div><div class="v">${escapeHtml(localDate)}</div></div>
    <div><div class="k">Inspector</div><div class="v">${escapeHtml(inspector)}</div></div>
    <div><div class="k">Cleaners</div><div class="v">${escapeHtml(cleaners)}</div></div>
  </div>

  <h2>How this score was reached</h2>
  <div class="qa-card">
    ${breakdownHtml}
    ${
      qa?.managementReview
        ? `<p class="qa-note">A critical finding placed this inspection under management review.</p>`
        : ""
    }
    ${
      internal && qa?.rawScore != null && qa.rawScore !== qa.score
        ? `<p class="qa-muted">Computed ${escapeHtml(Number(qa.rawScore).toFixed(0))}% · adjusted to ${escapeHtml(Number(qa.score).toFixed(0))}%${qa.adjustmentReason ? ` — ${escapeHtml(qa.adjustmentReason)}` : ""}</p>`
        : ""
    }
  </div>

  ${issuesHtml ? `<h2>Findings</h2>${issuesHtml}` : ""}

  ${
    submission
      ? `<h2>Checklist results</h2>${sectionsHtml || `<p class="qa-muted">No QA checklist captured.</p>`}`
      : `<p class="qa-muted">No QA submission recorded for this job yet.</p>`
  }

  ${cleanerMediaHtml ? `<h2>Cleaner's submitted evidence</h2><div class="qa-card">${cleanerMediaHtml}</div>` : ""}

  ${damageHtml ? `<h2>Damage findings</h2>${damageHtml}` : ""}

  ${reworkHtml ? `<h2>Rework</h2>${reworkHtml}` : ""}

  <h2>Attendance &amp; on-site evidence</h2>
  ${attendanceHtml}

  ${
    // The inspector's free-text notes are written for the office, not the
    // cleaner — the cleaner-facing wording lives on the issues above.
    internal && notes.trim()
      ? `<h2>QA inspector notes</h2><div class="qa-card"><p class="qa-body">${escapeHtml(notes)}</p></div>`
      : ""
  }

  ${signOffHtml}

  <footer>Generated by ${escapeHtml(companyName)} — Quality Inspection Report${internal ? "" : " (your copy)"} · ${new Date().toISOString()}</footer>
</body>
</html>`;

  return { html, jobNumber: job.jobNumber ?? job.id };
}
