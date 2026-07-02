import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { s3 } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { formatFieldValue, isUploadFieldType } from "@/lib/forms/field-types";
import {
  isTemplateConditionalMet,
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
} from "@/lib/forms/visibility";
import { QA_TOOLS_DATA_KEY } from "@/lib/qa/inspection-tools";
import { publicUrl } from "@/lib/s3";

const TZ = "Australia/Sydney";
export const REPORT_TEMPLATE_VERSION = "v4-themeable-evidence-branding";

type ReportThemeRecord = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  layout: any;
  logoUrl: string | null;
  primaryColorHsl: string | null;
  accentColorHsl: string | null;
  titleTemplate: string | null;
  footerHtml: string | null;
};

async function loadTheme(themeId?: string | null): Promise<ReportThemeRecord | null> {
  try {
    if (themeId) {
      const t = await (db as any).reportTheme.findUnique({ where: { id: themeId } });
      if (t) return t as ReportThemeRecord;
    }
    const def = await (db as any).reportTheme.findFirst({ where: { isDefault: true, isActive: true } });
    if (def) return def as ReportThemeRecord;
    return await (db as any).reportTheme.findFirst({ where: { isActive: true } });
  } catch {
    return null;
  }
}

function isSectionVisible(theme: ReportThemeRecord | null, sectionId: string): boolean {
  if (!theme?.layout?.sections) return true;
  const sections = Array.isArray(theme.layout.sections) ? theme.layout.sections : [];
  const found = sections.find((s: any) => s?.id === sectionId);
  if (!found) return true;
  return found.visible !== false;
}

function photoSizePx(theme: ReportThemeRecord | null): { w: number; h: number } {
  const size = theme?.layout?.photoSize ?? "medium";
  switch (size) {
    case "small":
      return { w: 120, h: 90 };
    case "medium":
      return { w: 200, h: 150 };
    case "large":
      return { w: 320, h: 240 };
    case "hero":
      return { w: 480, h: 360 };
    default:
      return { w: 200, h: 150 };
  }
}

function renderTitle(theme: ReportThemeRecord | null, ctx: { job: any; property: any }): string | null {
  const tpl = theme?.titleTemplate;
  if (!tpl) return null;
  return tpl
    .replace(/\{\{\s*job\.jobNumber\s*\}\}/g, String(ctx.job?.jobNumber ?? ctx.job?.id ?? ""))
    .replace(/\{\{\s*property\.name\s*\}\}/g, String(ctx.property?.name ?? ""))
    .replace(/\{\{\s*job\.scheduledFor\s*\|\s*date short\s*\}\}/g, String(ctx.job?.scheduledDate ? new Date(ctx.job.scheduledDate).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney" }) : ""));
}
const s3Enabled = Boolean(
  process.env.S3_BUCKET_NAME &&
    process.env.S3_PUBLIC_BASE_URL &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
);

type Conditional = {
  fieldId?: string;
  propertyField?: string;
  value?: unknown;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isBalconyLikeField(field: any) {
  const text = `${String(field?.id ?? "")} ${String(field?.label ?? "")}`.toLowerCase();
  return text.includes("balcony");
}

function isConditionMet(
  conditional: Conditional | undefined,
  answers: Record<string, unknown>,
  property: Record<string, unknown>
) {
  // Delegate to the shared form-visibility engine so the report honours the
  // full operator set (notEquals/answered/oneOf/gt/lt/…) exactly as the cleaner
  // form and required-field enforcement do. Previously this only did equality,
  // so any non-`equals` conditional rendered the wrong fields in the client PDF.
  return isTemplateConditionalMet(conditional, answers, property);
}

function isFieldVisibleInReport(
  field: any,
  conditional: Conditional | undefined,
  answers: Record<string, unknown>,
  property: Record<string, unknown>
) {
  if (property.hasBalcony !== true && isBalconyLikeField(field)) {
    return false;
  }
  return isConditionMet(conditional, answers, property);
}

function uploadCountForField(
  uploads: Record<string, unknown>,
  media: Array<{ fieldId: string }>,
  fieldId: string
): number {
  const raw = uploads[fieldId];
  if (typeof raw === "string") return raw.trim() ? 1 : 0;
  if (Array.isArray(raw)) {
    return raw.filter((item) => typeof item === "string" && item.trim()).length;
  }
  return media.filter((item) => item.fieldId === fieldId).length;
}

function buildFieldValue(field: any, context: { answers: Record<string, unknown>; uploads: Record<string, unknown>; submission: any }) {
  const { answers, uploads, submission } = context;
  if (!field?.id) return "-";

  if (isUploadFieldType(field.type)) {
    const count = uploadCountForField(uploads, submission?.media ?? [], String(field.id));
    return count > 0 ? `${count} file(s)` : "Not uploaded";
  }

  if (field.type === "inventory") {
    const txs = (submission?.stockTxs ?? []).filter((tx: any) => tx.quantity < 0);
    if (txs.length === 0) return "No inventory recorded";
    return txs
      .map(
        (tx: any) =>
          `${tx.propertyStock?.item?.name ?? tx.propertyStock?.itemId ?? "Item"}: ${Math.abs(tx.quantity)}`
      )
      .join(", ");
  }

  if (field.type === "signature") {
    const value = answers[field.id];
    return typeof value === "string" && value.trim().startsWith("data:image/")
      ? value.trim()
      : "-";
  }

  return formatFieldValue(field, answers[field.id]);
}

function checkboxMarkHtml(checked: boolean) {
  return checked ? "&#x2611;" : "&#x2610;";
}

function renderFieldMediaHtml(mediaRows: any[]): string {
  if (!mediaRows.length) return "<span style=\"color:#6b7280;\">-</span>";
  const items = mediaRows
    .map((m) => {
      const isVideo = String(m?.mediaType ?? "").toUpperCase() === "VIDEO";
      if (isVideo) {
        return `<a href="${m.url}" target="_blank" rel="noreferrer" style="display:inline-block;margin:4px 6px 4px 0;padding:6px 8px;background:#f3f4f6;border-radius:6px;font-size:11px;">${escapeHtml(
          m.label ?? m.fieldId
        )} (video)</a>`;
      }
      return `<img src="${m.url}" alt="${escapeHtml(m.label ?? m.fieldId)}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;margin:4px 6px 4px 0;border:1px solid #e5e7eb;" />`;
    })
    .join("");
  return `<div style="display:flex;flex-wrap:wrap;align-items:flex-start;">${items}</div>`;
}

function buildAdminRequestedTasksHtml(submission: any): { html: string; usedMediaIds: Set<string> } {
  const usedMediaIds = new Set<string>();
  const answers = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const tasks = Array.isArray(answers.__adminRequestedTasks)
    ? answers.__adminRequestedTasks.filter((item: any) => item && typeof item === "object")
    : [];
  if (tasks.length === 0) {
    return { html: "", usedMediaIds };
  }

  const rows = tasks
    .map((task: any) => {
      const photoFieldId = typeof task.photoFieldId === "string" ? task.photoFieldId : "";
      const mediaForTask = photoFieldId
        ? (submission?.media ?? []).filter((media: any) => media.fieldId === photoFieldId)
        : [];
      mediaForTask.forEach((media: any) => {
        if (media?.id) usedMediaIds.add(String(media.id));
      });
      const note = typeof task.note === "string" ? task.note.trim() : "";
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #fecaca;vertical-align:top;">
            <strong>${escapeHtml(task.title ?? "Admin requested task")}</strong>
            ${
              task.description
                ? `<div style="margin-top:4px;font-size:12px;color:#7f1d1d;">${escapeHtml(task.description)}</div>`
                : ""
            }
          </td>
          <td style="padding:10px;border-bottom:1px solid #fecaca;vertical-align:top;">
            <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;">
              ${task.completed ? "Completed" : "Incomplete"}
            </span>
            ${
              note
                ? `<div style="margin-top:8px;font-size:12px;color:#111827;"><strong>Cleaner note:</strong> ${escapeHtml(note)}</div>`
                : ""
            }
            <div style="margin-top:8px;font-size:11px;color:#7f1d1d;">
              ${task.requiresPhoto ? "Image proof required" : "No image proof required"}
              ${task.requiresNote ? " · Cleaner note required" : ""}
            </div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #fecaca;vertical-align:top;">
            ${renderFieldMediaHtml(mediaForTask)}
          </td>
        </tr>
      `;
    })
    .join("");

  return {
    html: `
      <div class="section" style="border:1px solid #fecaca;border-radius:14px;background:#fff1f2;padding:18px;">
        <h3 style="margin:0 0 10px;color:#b91c1c;">Admin Requested Tasks</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px;border-bottom:2px solid #fca5a5;text-align:left;">Task</th>
              <th style="padding:8px;border-bottom:2px solid #fca5a5;text-align:left;">Submission</th>
              <th style="padding:8px;border-bottom:2px solid #fca5a5;text-align:left;">Proof</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
    usedMediaIds,
  };
}

function buildUnifiedJobTasksHtml(submission: any): { html: string; usedMediaIds: Set<string> } {
  const usedMediaIds = new Set<string>();
  const answers = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const tasks = Array.isArray(answers.__jobTasks)
    ? answers.__jobTasks.filter((item: any) => item && typeof item === "object")
    : [];
  if (tasks.length === 0) {
    return { html: "", usedMediaIds };
  }

  const rows = tasks
    .map((task: any) => {
      const proofFieldId = typeof task.proofFieldId === "string" ? task.proofFieldId : "";
      const mediaForTask = proofFieldId
        ? (submission?.media ?? []).filter((media: any) => media.fieldId === proofFieldId)
        : [];
      mediaForTask.forEach((media: any) => {
        if (media?.id) usedMediaIds.add(String(media.id));
      });
      const note = typeof task.note === "string" ? task.note.trim() : "";
      const decision = String(task.decision ?? "OPEN");
      const decisionLabel =
        decision === "NOT_COMPLETED"
          ? "Not completed"
          : decision === "COMPLETED"
            ? "Completed"
            : decision.replace(/_/g, " ");
      return `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #bfdbfe;vertical-align:top;">
            <strong>${escapeHtml(task.title ?? "Job task")}</strong>
            ${
              task.description
                ? `<div style="margin-top:4px;font-size:12px;color:#334155;">${escapeHtml(task.description)}</div>`
                : ""
            }
            <div style="margin-top:8px;font-size:11px;color:#475569;">
              Source: ${escapeHtml(String(task.source ?? "ADMIN").replace(/_/g, " "))}
              ${task.approvalStatus ? ` • ${escapeHtml(String(task.approvalStatus).replace(/_/g, " "))}` : ""}
            </div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #bfdbfe;vertical-align:top;">
            <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:${
              decision === "NOT_COMPLETED" ? "#fee2e2" : "#dcfce7"
            };color:${decision === "NOT_COMPLETED" ? "#991b1b" : "#166534"};font-size:12px;font-weight:600;">
              ${escapeHtml(decisionLabel)}
            </span>
            ${
              note
                ? `<div style="margin-top:8px;font-size:12px;color:#111827;"><strong>${decision === "NOT_COMPLETED" ? "Reason" : "Cleaner note"}:</strong> ${escapeHtml(note)}</div>`
                : ""
            }
          </td>
          <td style="padding:10px;border-bottom:1px solid #bfdbfe;vertical-align:top;">
            ${renderFieldMediaHtml(mediaForTask)}
          </td>
        </tr>
      `;
    })
    .join("");

  return {
    html: `
      <div class="section" style="border:1px solid #bfdbfe;border-radius:14px;background:#eff6ff;padding:18px;">
        <h3 style="margin:0 0 10px;color:#1d4ed8;">Priority Job Tasks</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px;border-bottom:2px solid #93c5fd;text-align:left;">Task</th>
              <th style="padding:8px;border-bottom:2px solid #93c5fd;text-align:left;">Outcome</th>
              <th style="padding:8px;border-bottom:2px solid #93c5fd;text-align:left;">Proof</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `,
    usedMediaIds,
  };
}

function buildChecklistHtml(job: any, submission: any): { html: string; usedMediaIds: Set<string> } {
  const templateSchema =
    submission?.data &&
    typeof submission.data === "object" &&
    submission.data.__templateSchema &&
    typeof submission.data.__templateSchema === "object"
      ? submission.data.__templateSchema
      : submission?.template?.schema;

  const sections = Array.isArray(templateSchema?.sections)
    ? templateSchema.sections
    : [];
  const answers = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const uploads = answers?.uploads && typeof answers.uploads === "object" ? answers.uploads : {};
  const usedMediaIds = new Set<string>();

  const html = sections
    .filter((section: any) => isFieldVisibleInReport(section, section?.conditional, answers, job.property ?? {}))
    .map((section: any) => {
      // Flatten one level of `children` so sub-field answers/evidence appear in
      // the client report (they were previously dropped). Each flattened child
      // is visibility-gated on both its own and its parent's condition.
      const fields = flattenFieldsOneLevel(
        Array.isArray(section?.fields) ? section.fields : []
      ).filter(
        (field: any) =>
          // Own condition + balcony gate (isFieldVisibleInReport) AND the
          // parent's condition for flattened children (isFlattenedFieldVisible).
          isFieldVisibleInReport(field, field?.conditional, answers, job.property ?? {}) &&
          isFlattenedFieldVisible(field, answers, job.property ?? {})
      );
      if (fields.length === 0) return "";

      const rows = fields
        .map((field: any) => {
          const isCheckbox = field?.type === "checkbox";
          const checked = answers[field.id] === true;
          const value = buildFieldValue(field, { answers, uploads, submission });
          const mediaForField = (submission?.media ?? []).filter((m: any) => m.fieldId === field.id);
          mediaForField.forEach((m: any) => {
            if (m?.id) usedMediaIds.add(String(m.id));
          });
          const labelHtml = isCheckbox
            ? `<span style="display:inline-block;min-width:18px;font-size:14px;line-height:1;">${checkboxMarkHtml(checked)}</span>${escapeHtml(
                field.label ?? field.id ?? "-"
              )}`
            : escapeHtml(field.label ?? field.id ?? "-");
          const mediaHtml = renderFieldMediaHtml(mediaForField);
          const valueHtml =
            field?.type === "signature" && typeof value === "string" && value !== "-"
              ? `<img src="${value}" alt="${escapeHtml(field.label ?? field.id ?? "Signature")}" style="width:220px;height:90px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:6px;" />`
              : escapeHtml(value);
          return `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${labelHtml}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${isCheckbox ? "&nbsp;" : valueHtml}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${mediaHtml}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="section">
          <h3 style="margin:0 0 8px 0;">${escapeHtml(section.label ?? "Section")}</h3>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Checklist Item</th>
                <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Submitted Value</th>
                <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Evidence</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    })
    .join("");
  return { html, usedMediaIds };
}

/**
 * Build the client-facing "Quality inspection" section from the latest QA
 * submission. Deliberately client-appropriate: QA pass/fail + score, the QA
 * inspector's client-safe notes, a compact damage-findings summary, and the
 * inspector's section photos. Internal pay/rework $ and cleaner-blame details
 * are intentionally EXCLUDED — those live only in the standalone QA report.
 */
function buildQaSummaryHtml(
  qaSubmission: any,
  qa: any,
  photoDims: { w: number; h: number }
): { html: string; photoKeys: string[] } {
  const data =
    qaSubmission?.data && typeof qaSubmission.data === "object"
      ? (qaSubmission.data as Record<string, unknown>)
      : {};
  const tools =
    data[QA_TOOLS_DATA_KEY] && typeof data[QA_TOOLS_DATA_KEY] === "object"
      ? (data[QA_TOOLS_DATA_KEY] as Record<string, any>)
      : null;

  const score = qa?.score ?? qaSubmission?.score ?? null;
  const passed = qa?.passed ?? qaSubmission?.passed ?? null;
  const notes = String(qa?.notes ?? qaSubmission?.notes ?? "").trim();

  // Section photos → flat key list for the gallery.
  const sectionPhotos: Record<string, unknown> =
    tools?.sectionPhotos && typeof tools.sectionPhotos === "object" ? tools.sectionPhotos : {};
  const photoKeys: string[] = [];
  for (const value of Object.values(sectionPhotos)) {
    if (Array.isArray(value)) {
      for (const k of value) if (typeof k === "string" && k.trim()) photoKeys.push(k);
    }
  }

  // Compact damage findings (area + severity + short description). No costs.
  const damage = Array.isArray(tools?.damage) ? tools.damage : [];
  const damageRows = damage
    .filter((d: any) => d && (d.area || d.description))
    .map(
      (d: any) => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${escapeHtml(d.area || "—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${escapeHtml(String(d.severity ?? ""))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${escapeHtml(d.description || "—")}</td>
        </tr>`
    )
    .join("");

  // Nothing meaningful to show → no section.
  if (score == null && !notes && !damageRows && photoKeys.length === 0) {
    return { html: "", photoKeys: [] };
  }

  const photoHtml = photoKeys.length
    ? `<div class="media-grid" style="margin-top:12px;">${photoKeys
        .map(
          (key) =>
            `<div class="media-item"><img src="${escapeHtml(publicUrl(key))}" alt="QA inspection photo" style="width:${photoDims.w}px;height:${photoDims.h}px;object-fit:cover;border-radius:8px;" /></div>`
        )
        .join("")}</div>`
    : "";

  const html = `
    <div class="section">
      <h3 style="margin:0 0 8px 0;">Quality inspection</h3>
      ${
        score != null
          ? `<p>Result: <span class="badge ${passed ? "pass" : "fail"}">${Number(score).toFixed(0)}% — ${passed ? "PASSED" : "FAILED"}</span></p>`
          : ""
      }
      ${notes ? `<div class="label">Inspector notes</div><div class="value" style="white-space:pre-wrap;">${escapeHtml(notes)}</div>` : ""}
      ${
        damageRows
          ? `<div class="label" style="margin-top:12px;">Damage findings</div>
             <table style="width:100%;border-collapse:collapse;margin-top:6px;">
               <thead><tr>
                 <th style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;">Area</th>
                 <th style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;">Severity</th>
                 <th style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;">Detail</th>
               </tr></thead>
               <tbody>${damageRows}</tbody>
             </table>`
          : ""
      }
      ${photoHtml ? `<div class="label" style="margin-top:12px;">Inspection photos</div>${photoHtml}` : ""}
    </div>`;

  return { html, photoKeys };
}

/** Generate and store a job report HTML + PDF. */
export async function generateJobReport(jobId: string, themeId?: string | null): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      property: { include: { client: true } },
      assignments: { include: { user: { select: { name: true } } } },
      formSubmissions: {
        include: {
          template: true,
          media: true,
          stockTxs: {
            include: {
              propertyStock: {
                include: { item: true },
              },
            },
          },
          submittedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      qaReviews: { orderBy: { createdAt: "desc" }, take: 1 },
      qaFormSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { submittedBy: { select: { name: true } } },
      },
    },
  });

  if (!job) throw new Error(`Job ${jobId} not found`);

  const submission = job.formSubmissions[0];
  const qa = job.qaReviews[0];
  const qaSubmission = job.qaFormSubmissions?.[0] ?? null;
  const localDate = format(toZonedTime(job.scheduledDate, TZ), "dd MMMM yyyy");
  const settings = await getAppSettings();
  const theme = await loadTheme(themeId);

  const html = buildReportHtml({ job, submission, qa, qaSubmission, localDate, settings, theme });

  const htmlKey = `reports/${jobId}/report.html`;
  let storedHtmlKey: string | null = null;
  if (s3Enabled) {
    try {
      await s3
        .putObject({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: htmlKey,
          Body: html,
          ContentType: "text/html",
        })
        .promise();
      storedHtmlKey = htmlKey;
    } catch (err) {
      logger.error({ err, jobId }, "Failed to upload report HTML to S3; keeping DB copy only");
    }
  }

  let pdfUrl: string | null = null;

  try {
    const { renderPdfFromHtml } = await import("./pdf");
    const pdfBuffer = await renderPdfFromHtml(html, "job report PDF generation");

    if (s3Enabled) {
      const pdfKey = `reports/${jobId}/report.pdf`;
      await s3
        .putObject({
          Bucket: process.env.S3_BUCKET_NAME!,
          Key: pdfKey,
          Body: pdfBuffer,
          ContentType: "application/pdf",
        })
        .promise();

      pdfUrl = `${process.env.S3_PUBLIC_BASE_URL}/${pdfKey}`;
    }
  } catch (err) {
    logger.error({ err, jobId }, "PDF generation failed; storing HTML only");
  }

  await db.report.upsert({
    where: { jobId },
    create: {
      jobId,
      htmlContent: html,
      pdfUrl,
      s3Key: storedHtmlKey,
      themeId: theme?.id ?? null,
    },
    update: {
      htmlContent: html,
      pdfUrl,
      s3Key: storedHtmlKey,
      themeId: theme?.id ?? null,
      updatedAt: new Date(),
    },
  });

  logger.info({ jobId, pdfUrl }, "Job report generated");
}

function buildReportHtml({ job, submission, qa, qaSubmission, localDate, settings, theme }: any): string {
  const checklist = submission ? buildChecklistHtml(job, submission) : { html: "", usedMediaIds: new Set<string>() };
  const adminRequestedTasks = submission
    ? buildAdminRequestedTasksHtml(submission)
    : { html: "", usedMediaIds: new Set<string>() };
  const unifiedJobTasks = submission
    ? buildUnifiedJobTasksHtml(submission)
    : { html: "", usedMediaIds: new Set<string>() };
  const checklistHtml = checklist.html;
  const remainingMedia = (submission?.media ?? []).filter(
    (m: any) =>
      !checklist.usedMediaIds.has(String(m.id)) &&
      !adminRequestedTasks.usedMediaIds.has(String(m.id)) &&
      !unifiedJobTasks.usedMediaIds.has(String(m.id))
  );
  const themeRec: ReportThemeRecord | null = theme ?? null;
  const photoDims = photoSizePx(themeRec);
  const remainingMediaHtml = renderFieldMediaHtml(remainingMedia);
  const companyName = settings?.companyName || "sNeek Property Services";
  const themedLogo = themeRec?.logoUrl?.trim() || "";
  const logoUrl = themedLogo || settings?.reportLogoUrl?.trim() || settings?.logoUrl?.trim() || "";
  const primaryHsl = themeRec?.primaryColorHsl || "200 98% 39%"; // sky-600-ish
  const accentHsl = themeRec?.accentColorHsl || primaryHsl;
  const density = themeRec?.layout?.density ?? "default";
  const photoSize = themeRec?.layout?.photoSize ?? "medium";
  const showHeader = isSectionVisible(themeRec, "header");
  const showSummary = isSectionVisible(themeRec, "summary");
  const showTaskChecklist = isSectionVisible(themeRec, "task-checklist");
  const showGallery = isSectionVisible(themeRec, "before-after-gallery");
  const showSignature = isSectionVisible(themeRec, "signature");
  const showFooter = isSectionVisible(themeRec, "footer");
  const showQaSummary = isSectionVisible(themeRec, "qa-summary");
  const renderedTitle = renderTitle(themeRec, { job, property: job.property }) || `${companyName} Cleaning Report`;
  const customFooter = themeRec?.footerHtml?.trim() || "";
  const template = String(themeRec?.layout?.template ?? "classic");

  const densityPad = density === "compact" ? "24px" : density === "comfortable" ? "56px" : "40px";
  const sectionMargin = density === "compact" ? "14px" : density === "comfortable" ? "32px" : "24px";

  // Client-facing QA summary (gated by the "qa-summary" theme section).
  const qaSummary = showQaSummary ? buildQaSummaryHtml(qaSubmission, qa, photoDims) : { html: "", photoKeys: [] };

  const summaryInnerHtml = `<p><strong>${escapeHtml(job.property.name)}</strong> - ${escapeHtml(job.property.address)}, ${escapeHtml(job.property.suburb)}</p>
<p>Job Number: ${escapeHtml(job.jobNumber ?? job.id)}</p>
<p>Date: ${escapeHtml(localDate)} | Type: ${escapeHtml(job.jobType.replace(/_/g, " "))}</p>
<p>Cleaners: ${escapeHtml(job.assignments.map((a: any) => a.user.name).join(", ") || "N/A")}</p>
${
  qa
    ? `<p>QA Score: <span class="badge ${qa.passed ? "pass" : "fail"}">${qa.score.toFixed(0)}% - ${qa.passed ? "PASSED" : "FAILED"}</span></p>`
    : ""
}
<div class="section">
  <div class="label">Submitted By</div>
  <div class="value">${escapeHtml(submission?.submittedBy?.name ?? "Unknown")}</div>
</div>
${
  submission
    ? `<div class="section">
  <div class="label">Laundry Ready</div>
  <div class="value">${submission.laundryReady === true ? "Yes" : submission.laundryReady === false ? "No" : "-"}</div>
  ${submission.bagLocation ? `<div class="value">Bag location: ${escapeHtml(submission.bagLocation)}</div>` : ""}
</div>`
    : ""
}`;

  const tasksHtml = showTaskChecklist ? `${adminRequestedTasks.html}\n${unifiedJobTasks.html}` : "";
  const checklistBodyHtml = showTaskChecklist
    ? checklistHtml || "<div class=\"section\"><p>No checklist values captured.</p></div>"
    : "";
  const galleryHtml =
    showGallery && remainingMedia.length > 0
      ? `<div class="section">
  <div class="label">Additional Evidence</div>
  <div class="media-grid photo-${photoSize}">${remainingMediaHtml}</div>
</div>`
      : "";
  const footerHtml = showFooter
    ? `<footer>${customFooter || `Generated by ${escapeHtml(companyName)} Dashboard - ${new Date().toISOString()}`}</footer>`
    : "";

  const headTags = `<meta charset="UTF-8"/>
<!-- report-template:${REPORT_TEMPLATE_VERSION} -->
<!-- report-theme:${escapeHtml(themeRec?.kind ?? "DEFAULT")}:${escapeHtml(themeRec?.id ?? "none")} -->
<!-- report-style:${escapeHtml(template)} -->`;

  const ctx = {
    headTags,
    primaryHsl,
    accentHsl,
    densityPad,
    sectionMargin,
    photoDims,
    photoSize,
    companyName,
    logoUrl,
    renderedTitle,
    showHeader,
    showSummary,
    summaryInnerHtml,
    tasksHtml,
    checklistBodyHtml,
    galleryHtml,
    qaSummaryHtml: qaSummary.html,
    footerHtml,
    job,
  };

  return template === "luxury" ? renderLuxuryReport(ctx) : renderClassicReport(ctx);
}

type ReportRenderCtx = {
  headTags: string;
  primaryHsl: string;
  accentHsl: string;
  densityPad: string;
  sectionMargin: string;
  photoDims: { w: number; h: number };
  photoSize: string;
  companyName: string;
  logoUrl: string;
  renderedTitle: string;
  showHeader: boolean;
  showSummary: boolean;
  summaryInnerHtml: string;
  tasksHtml: string;
  checklistBodyHtml: string;
  galleryHtml: string;
  qaSummaryHtml: string;
  footerHtml: string;
  job: any;
};

/** The original "classic" report skin (unchanged markup, now QA-summary-aware). */
function renderClassicReport(c: ReportRenderCtx): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
${c.headTags}
<style>
  :root {
    --primary: hsl(${c.primaryHsl});
    --accent: hsl(${c.accentHsl});
  }
  body { font-family: Arial, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: ${c.densityPad}; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom: 10px; }
  .brand img { max-width:180px; max-height:64px; width:auto; height:auto; object-fit:contain; }
  .brand h1 { margin:0; color: var(--primary); }
  h1, h3 { color: var(--primary); }
  .section { margin: ${c.sectionMargin} 0; }
  .label { font-size: 12px; color: #666; text-transform: uppercase; }
  .value { font-size: 16px; margin-top: 4px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; }
  .pass { background: #dcfce7; color: #16a34a; }
  .fail { background: #fee2e2; color: #dc2626; }
  .media-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .media-item img { width: ${c.photoDims.w}px; height: ${c.photoDims.h}px; object-fit: cover; border-radius: 8px; }
  .media-item a { display: inline-block; padding: 8px; background: #f3f4f6; border-radius: 8px; font-size: 12px; }
  /* theme-driven photo sizing inside field-media renders */
  div[style*="display:flex"] img { width: ${c.photoDims.w}px !important; height: ${c.photoDims.h}px !important; }
  .photo-${c.photoSize} img { width: ${c.photoDims.w}px; height: ${c.photoDims.h}px; }
  .hero-banner { width: 100%; border-radius: 12px; overflow: hidden; margin: 0 0 ${c.sectionMargin}; border: 1px solid #e5e7eb; }
  .hero-banner img { width: 100%; height: 100%; object-fit: cover; display: block; }
  footer { margin-top: 40px; font-size: 12px; color: #999; }
</style>
</head>
<body>
${c.showHeader ? `<div class="brand">
  ${c.logoUrl ? `<img src="${escapeHtml(c.logoUrl)}" alt="${escapeHtml(c.companyName)} logo" style="background:#ffffff;border-radius:8px;padding:6px;" />` : ""}
  <h1>${escapeHtml(c.renderedTitle)}</h1>
</div>` : ""}
${c.showSummary ? c.summaryInnerHtml : ""}
${c.tasksHtml}
${c.checklistBodyHtml}
${c.qaSummaryHtml}
${c.galleryHtml}
${c.footerHtml}
</body>
</html>`;
}

/**
 * The "luxury" report skin — a premium, magazine-grade layout. Same data and
 * sections as classic, just a far more refined presentation: serif display
 * headings (system serif stack, no external fonts so it stays A4/print-safe in
 * Playwright), a hero header band, hairline dividers, rounded soft-shadow photo
 * grid, and an elegant footer. Inline CSS only — no JS or web-font fetches.
 */
function renderLuxuryReport(c: ReportRenderCtx): string {
  const serif = `"Cormorant Garamond", "Hoefler Text", Garamond, "Times New Roman", Georgia, serif`;
  const sans = `"Helvetica Neue", Helvetica, Arial, sans-serif`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
${c.headTags}
<style>
  :root {
    --primary: hsl(${c.primaryHsl});
    --accent: hsl(${c.accentHsl});
    --ink: #1f2733;
    --muted: #6b7280;
    --hairline: rgba(31,39,51,0.12);
  }
  * { box-sizing: border-box; }
  body { font-family: ${sans}; color: var(--ink); max-width: 920px; margin: 0 auto; padding: 0 ${c.densityPad} ${c.densityPad}; -webkit-print-color-adjust: exact; }
  h1, h2, h3 { font-family: ${serif}; font-weight: 600; letter-spacing: 0.01em; color: var(--primary); }
  p { line-height: 1.6; }

  .lux-hero {
    margin: 0 -${c.densityPad} ${c.sectionMargin};
    padding: 48px ${c.densityPad} 40px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, #ffffff) 0%, #ffffff 70%);
    border-bottom: 1px solid var(--hairline);
  }
  .lux-hero .eyebrow { font-family: ${sans}; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }
  .lux-hero img { max-width: 200px; max-height: 70px; object-fit: contain; display: block; margin-bottom: 22px; }
  .lux-hero h1 { margin: 0; font-size: 44px; line-height: 1.05; }
  .lux-hero .sub { font-family: ${sans}; color: var(--muted); font-size: 14px; margin: 12px 0 0; }

  .section { margin: ${c.sectionMargin} 0; }
  h3 { font-size: 24px; margin: 0 0 4px; }
  h3 + * { margin-top: 12px; }
  .rule { height: 1px; background: var(--hairline); border: 0; margin: 6px 0 16px; }
  .label { font-family: ${sans}; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); }
  .value { font-size: 16px; margin-top: 4px; color: var(--ink); }

  .lux-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 40px; padding: 22px 26px; border: 1px solid var(--hairline); border-radius: 18px; background: #fff; }
  .lux-summary .k { font-family: ${sans}; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .lux-summary .v { font-family: ${serif}; font-size: 19px; color: var(--ink); margin-top: 2px; }

  .badge { display: inline-block; padding: 5px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
  .pass { background: #e7f6ec; color: #16794a; }
  .fail { background: #fdeaea; color: #c53030; }

  table { width: 100%; border-collapse: collapse; }
  th { font-family: ${sans}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--hairline); }
  td { padding: 11px 12px; border-bottom: 1px solid var(--hairline); vertical-align: top; }

  .media-grid { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 14px; }
  .media-item img { width: ${c.photoDims.w}px; height: ${c.photoDims.h}px; object-fit: cover; border-radius: 14px; box-shadow: 0 6px 18px rgba(31,39,51,0.12); }
  .media-item a { display: inline-block; padding: 8px 10px; background: #f5f6f8; border-radius: 12px; font-size: 12px; }
  div[style*="display:flex"] img { width: ${c.photoDims.w}px !important; height: ${c.photoDims.h}px !important; border-radius: 14px !important; }
  .photo-${c.photoSize} img { width: ${c.photoDims.w}px; height: ${c.photoDims.h}px; }

  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--hairline); font-family: ${sans}; font-size: 11px; letter-spacing: 0.02em; color: var(--muted); text-align: center; }
</style>
</head>
<body>
${c.showHeader ? `<div class="lux-hero">
  ${c.logoUrl ? `<img src="${escapeHtml(c.logoUrl)}" alt="${escapeHtml(c.companyName)} logo" style="background:#ffffff;border-radius:8px;padding:6px;" />` : `<p class="eyebrow">${escapeHtml(c.companyName)}</p>`}
  <h1>${escapeHtml(c.job?.property?.name || c.renderedTitle)}</h1>
  <p class="sub">${escapeHtml(c.renderedTitle)}</p>
</div>` : ""}
${c.showSummary ? `<div class="section"><div class="lux-summary">${c.summaryInnerHtml}</div></div>` : ""}
${c.tasksHtml}
${c.checklistBodyHtml}
${c.qaSummaryHtml}
${c.galleryHtml}
${c.footerHtml}
</body>
</html>`;
}
