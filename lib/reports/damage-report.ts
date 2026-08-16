/**
 * D3 — the damage report document.
 *
 * Built on demand and NEVER persisted, deliberately following qa-report.ts
 * rather than generator.ts. The cleaning report is stored because it is the
 * artefact of a completed job and one exists per job; damage is different —
 * a job can produce several reports, admins edit costs afterwards, and a
 * released report can be retracted. A stored HTML blob would go stale the
 * moment any of that happened, and `Report.jobId` is UNIQUE so there is nowhere
 * to put a second document per job anyway.
 *
 * Three things this shares with the QA report, for the same reasons:
 *
 *   1. Images are PRESIGNED, not public URLs. Playwright renders the document
 *      on about:blank with no session, so a cookie-gated or private-bucket URL
 *      arrives as a broken image. Every key is presigned in one pass up front.
 *   2. The audience is derived from the caller's role, never from a query
 *      parameter — the client copy must not be obtainable by editing a URL.
 *   3. It carries its own template-version marker, independent of the cleaning
 *      report's, so the two can evolve separately.
 *
 * Redaction is NOT re-implemented here: the audience is handed to
 * lib/damage/investigation.ts, which is the single place that decides what each
 * audience may see and is unit-tested on exactly that.
 */

import { getPresignedDownloadUrl } from "@/lib/s3";
import {
  getDamageInvestigationForAdmin,
  listDamageReportPhotoKeys,
  toInvestigationViewModel,
  type DamageAudience,
  type DamageInvestigation,
} from "@/lib/damage/investigation";
import { db } from "@/lib/db";
import { ensureDamageReportVerification } from "@/lib/reports/verification";
import { formatVerificationCode } from "@/lib/reports/verification-code";
import { getAppSettings } from "@/lib/settings";

export const DAMAGE_REPORT_TEMPLATE_VERSION = "damage-v1-estate";

const PRESIGN_TTL_SECONDS = 3600;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function titleCase(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatMoney(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

/**
 * Presign every photo key once, then hand the view model a synchronous lookup.
 * Presigning inside the mapper would make it async and force the template to
 * await per image.
 */
async function buildUrlMap(reportId: string): Promise<Map<string, string>> {
  const keys = Array.from(new Set(await listDamageReportPhotoKeys(reportId)));
  const map = new Map<string, string>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        map.set(key, await getPresignedDownloadUrl(key, PRESIGN_TTL_SECONDS));
      } catch {
        // A photo that cannot be signed is omitted rather than rendered broken;
        // the rest of the report still stands as evidence.
      }
    })
  );
  return map;
}

function renderItem(
  item: DamageInvestigation["items"][number],
  index: number,
  isAdmin: boolean
): string {
  const photos = item.photos
    .filter((photo) => photo.url)
    .map(
      (photo) => `
        <figure class="ph">
          <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(item.category)} — ${escapeHtml(titleCase(photo.section))}" />
          <figcaption>${escapeHtml(titleCase(photo.section))}${photo.annotated ? " · marked up" : ""}${photo.caption ? ` · ${escapeHtml(photo.caption)}` : ""}</figcaption>
        </figure>`
    )
    .join("");

  const repairs = item.maintenance
    .map(
      (m) =>
        `<li>${escapeHtml(m.title)} — <strong>${escapeHtml(titleCase(m.status))}</strong>${
          m.assignedWorkerName ? ` · ${escapeHtml(m.assignedWorkerName)}` : ""
        }</li>`
    )
    .join("");

  return `
    <section class="item">
      <h3>${index + 1}. ${escapeHtml(item.category)} — ${escapeHtml(item.area)}</h3>
      <p class="meta">
        Severity: <strong>${escapeHtml(titleCase(item.severity))}</strong> ·
        Suspected cause: ${escapeHtml(titleCase(item.suspectedCause))} ·
        Case: ${escapeHtml(item.caseState ? titleCase(item.caseState) : "Not opened")}
        ${isAdmin ? ` · Estimated cost: <strong>${escapeHtml(formatMoney(item.estimatedCost))}</strong>` : ""}
      </p>
      <p class="desc">${escapeHtml(item.description)}</p>
      ${photos ? `<div class="photos">${photos}</div>` : ""}
      ${repairs ? `<ul class="repairs">${repairs}</ul>` : ""}
    </section>`;
}

/**
 * Render the damage report as a standalone HTML document.
 *
 * @param reportId the DamageReport id
 * @param audience decides what is shown — ADMIN sees costs, CLIENT does not.
 *                 Resolve it from the session, never from user input.
 * @returns null when the report does not exist
 */
export async function buildDamageReportHtml(
  reportId: string,
  audience: DamageAudience
): Promise<{ html: string; reference: string } | null> {
  const urls = await buildUrlMap(reportId);
  const resolve = (key: string) => urls.get(key) ?? "";

  const adminVm = await getDamageInvestigationForAdmin(reportId, resolve);
  if (!adminVm) return null;

  let vm = adminVm;
  if (audience === "CLIENT") {
    // Re-shaped through the same assembler rather than stripped by hand here —
    // one place decides what a client may see.
    const row = await db.damageReport.findUnique({
      where: { id: reportId },
      include: {
        reportedBy: { select: { name: true, email: true } },
        reviewedBy: { select: { name: true, email: true } },
        property: { select: { id: true, name: true } },
        items: {
          orderBy: { createdAt: "asc" },
          include: {
            photos: { orderBy: { createdAt: "asc" } },
            case: {
              include: {
                transitions: {
                  orderBy: { occurredAt: "asc" },
                  include: { actor: { select: { name: true, email: true } } },
                },
                maintenanceItems: { include: { assignedWorker: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!row) return null;
    vm = toInvestigationViewModel(row, "CLIENT", resolve);
  }

  const isAdmin = audience === "ADMIN";
  const settings = await getAppSettings();
  const companyName = String((settings as any)?.companyName ?? "sNeek Property Services");

  const { code } = await ensureDamageReportVerification(reportId);
  const reference = formatVerificationCode(code);

  const totalCost = isAdmin
    ? vm.items.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0)
    : null;

  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<!-- report-template:${DAMAGE_REPORT_TEMPLATE_VERSION} -->
<title>Damage report — ${escapeHtml(vm.propertyName ?? "Property")}</title>
<style>
  /* Inline only — the PDF renderer loads no external CSS or fonts. */
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1d211f; margin: 0; padding: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h3 { font-size: 15px; margin: 0 0 6px; }
  .sub { color: #5d6663; font-size: 12px; margin: 0 0 20px; }
  .item { border-top: 1px solid #ddd8cf; padding: 16px 0; page-break-inside: avoid; }
  .meta { font-size: 12px; color: #4a534f; margin: 0 0 6px; }
  .desc { font-size: 13px; white-space: pre-wrap; margin: 0 0 10px; }
  .photos { display: flex; flex-wrap: wrap; gap: 8px; }
  .ph { margin: 0; width: 168px; }
  .ph img { width: 100%; height: 126px; object-fit: cover; border: 1px solid #ddd8cf; }
  .ph figcaption { font-size: 10px; color: #6b7370; margin-top: 2px; }
  .repairs { font-size: 12px; color: #4a534f; margin: 8px 0 0; padding-left: 18px; }
  .verify { margin-top: 28px; border: 1px solid #c9a44c; padding: 12px; font-size: 12px; }
  .verify code { font-family: "Courier New", monospace; font-size: 14px; letter-spacing: 1px; }
  .total { margin-top: 16px; font-size: 14px; }
</style></head>
<body>
  <h1>Damage report — ${escapeHtml(vm.propertyName ?? "Property")}</h1>
  <p class="sub">
    ${escapeHtml(companyName)} ·
    ${vm.items.length} item${vm.items.length === 1 ? "" : "s"} ·
    Reported by ${escapeHtml(vm.reportedByName ?? "a cleaner")} ·
    Submitted ${escapeHtml(formatDate(vm.submittedAt))}
  </p>

  ${vm.items.map((item, i) => renderItem(item, i, isAdmin)).join("")}

  ${
    isAdmin && totalCost !== null
      ? `<p class="total">Total estimated repair cost: <strong>${escapeHtml(formatMoney(totalCost))}</strong></p>`
      : ""
  }

  <div class="verify">
    Verify this report at <strong>/verify</strong> using code <code>${escapeHtml(reference)}</code>.
    The public check confirms this report exists and when it was issued; it does not
    reveal its contents.
  </div>
</body></html>`;

  return { html, reference };
}
