import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { s3 } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const TZ = "Australia/Sydney";
export const REPORT_TEMPLATE_VERSION = "v3-inline-evidence-branding";
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

function valuesEqual(left: unknown, right: unknown) {
  if (typeof left === "boolean") return left === (right === true || right === "true");
  if (typeof left === "number") return left === Number(right);
  if (typeof right === "boolean") return (left === true || left === "true") === right;
  if (typeof right === "number") return Number(left) === right;
  return String(left ?? "") === String(right ?? "");
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
  if (!conditional || typeof conditional !== "object") return true;

  if (conditional.propertyField) {
    return valuesEqual(property[conditional.propertyField], conditional.value);
  }

  if (conditional.fieldId) {
    return valuesEqual(answers[conditional.fieldId], conditional.value);
  }

  return true;
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

  if (field.type === "upload") {
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

  const value = answers[field.id];
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
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
      const fields = (Array.isArray(section?.fields) ? section.fields : []).filter((field: any) =>
        isFieldVisibleInReport(field, field?.conditional, answers, job.property ?? {})
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

/** Generate and store a job report HTML + PDF. */
export async function generateJobReport(jobId: string): Promise<void> {
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
    },
  });

  if (!job) throw new Error(`Job ${jobId} not found`);

  const submission = job.formSubmissions[0];
  const qa = job.qaReviews[0];
  const localDate = format(toZonedTime(job.scheduledDate, TZ), "dd MMMM yyyy");
  const settings = await getAppSettings();

  const html = buildReportHtml({ job, submission, qa, localDate, settings });

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

  // Render to PDF via Playwright (best-effort - skip if Playwright unavailable)
  try {
    const { chromium } = await import("playwright");
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    let launchError: unknown = null;
    try {
      browser = await chromium.launch();
    } catch (err) {
      launchError = err;
      browser = await chromium.launch({ channel: "msedge" }).catch(async () => {
        return chromium.launch({ channel: "chrome" });
      });
    }
    if (!browser) {
      throw launchError ?? new Error("Could not launch browser for report PDF generation.");
    }
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    await browser.close();

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
    },
    update: {
      htmlContent: html,
      pdfUrl,
      s3Key: storedHtmlKey,
      updatedAt: new Date(),
    },
  });

  logger.info({ jobId, pdfUrl }, "Job report generated");
}

function buildReportHtml({ job, submission, qa, localDate, settings }: any): string {
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
  const remainingMediaHtml = renderFieldMediaHtml(remainingMedia);
  const companyName = settings?.companyName || "sNeek Property Services";
  const logoUrl = settings?.logoUrl?.trim() || "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<!-- report-template:${REPORT_TEMPLATE_VERSION} -->
<style>
  body { font-family: Arial, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 40px; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom: 10px; }
  .brand img { width:52px; height:52px; object-fit:contain; border-radius:10px; border:1px solid #e5e7eb; padding:4px; background:#fff; }
  .brand h1 { margin:0; color: #0284c7; }
  h1 { color: #0284c7; }
  .section { margin: 24px 0; }
  .label { font-size: 12px; color: #666; text-transform: uppercase; }
  .value { font-size: 16px; margin-top: 4px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; }
  .pass { background: #dcfce7; color: #16a34a; }
  .fail { background: #fee2e2; color: #dc2626; }
  .media-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .media-item img { width: 180px; height: 135px; object-fit: cover; border-radius: 8px; }
  .media-item a { display: inline-block; padding: 8px; background: #f3f4f6; border-radius: 8px; font-size: 12px; }
  footer { margin-top: 40px; font-size: 12px; color: #999; }
</style>
</head>
<body>
<div class="brand">
  ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)} logo" />` : ""}
  <h1>${escapeHtml(companyName)} Cleaning Report</h1>
</div>
<p><strong>${escapeHtml(job.property.name)}</strong> - ${escapeHtml(job.property.address)}, ${escapeHtml(job.property.suburb)}</p>
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
}
${adminRequestedTasks.html}
${unifiedJobTasks.html}
${checklistHtml || "<div class=\"section\"><p>No checklist values captured.</p></div>"}
${
  remainingMedia.length > 0
    ? `<div class="section">
  <div class="label">Additional Evidence</div>
  <div class="media-grid">${remainingMediaHtml}</div>
</div>`
    : ""
}
<footer>Generated by ${escapeHtml(companyName)} Dashboard - ${new Date().toISOString()}</footer>
</body>
</html>`;
}
