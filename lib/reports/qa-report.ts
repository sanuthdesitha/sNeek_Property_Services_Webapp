import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { getAppSettings } from "@/lib/settings";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { QA_TOOLS_DATA_KEY, type QaInspectionTools } from "@/lib/qa/inspection-tools";

const TZ = "Australia/Sydney";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve an S3 key to a URL the Playwright renderer can fetch. Matches the
 * existing report/damage-case approach (publicUrl), which the PDF image route
 * downscales transparently. */
function keyUrl(key: string): string {
  return publicUrl(key);
}

function photoGridHtml(
  keys: string[],
  opts: { size?: number; annotations?: Record<string, { overlayKey?: string; comment?: string }> } = {}
): string {
  if (!keys.length) return "";
  const size = opts.size ?? 150;
  const items = keys
    .map((key) => {
      const ann = opts.annotations?.[key];
      const overlay = ann?.overlayKey
        ? `<img src="${escapeHtml(keyUrl(ann.overlayKey))}" alt="" style="position:absolute;inset:0;width:${size}px;height:${size}px;object-fit:cover;border-radius:10px;" />`
        : "";
      const comment = ann?.comment
        ? `<p style="margin:4px 0 0;width:${size}px;font-size:10px;line-height:1.3;color:#b91c1c;">${escapeHtml(ann.comment)}</p>`
        : "";
      return `<div style="position:relative;width:${size}px;">
        <div style="position:relative;width:${size}px;height:${size}px;">
          <img src="${escapeHtml(keyUrl(key))}" alt="QA photo" style="position:absolute;inset:0;width:${size}px;height:${size}px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;" />
          ${overlay}
        </div>
        ${comment}
      </div>`;
    })
    .join("");
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;align-items:flex-start;">${items}</div>`;
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

/** Build the standalone Quality Inspection Report HTML for a job. */
export async function buildQaReportHtml(jobId: string): Promise<{ html: string; jobNumber: string } | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      property: { include: { client: true } },
      assignments: { where: { removedAt: null }, include: { user: { select: { name: true, email: true } } } },
      qaReviews: { orderBy: { createdAt: "desc" }, take: 1, include: { reviewedBy: { select: { name: true, email: true } } } },
      qaFormSubmissions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          template: true,
          submittedBy: { select: { name: true, email: true } },
          assignment: { include: { assignedTo: { select: { name: true } }, pickedUpBy: { select: { name: true } } } },
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
  const logoUrl = settings?.reportLogoUrl?.trim() || settings?.logoUrl?.trim() || "";

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

  // Template engine v2 branch (rebrand doc 03 §5.3), gated per-kind and OFF by
  // default → byte-identical legacy report until doc.qaReport is flipped. Lazy
  // import avoids a load-time cycle (the resolver imports this module's siblings).
  try {
    const { resolveQaReportHtml } = await import("@/lib/templates/resolve/qa-report");
    const v2 = await resolveQaReportHtml(
      { job, submission, qa, tools, localDate, inspector, cleaners, onSiteMinutes, jobId },
      keyUrl,
    );
    if (v2) return { html: v2.html, jobNumber: job.jobNumber ?? job.id };
  } catch {
    // fall through to the legacy renderer
  }

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
          return `
            <tr>
              <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;color:#334155;">${escapeHtml(field.label ?? field.id)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;font-weight:600;color:#0f172a;">${escapeHtml(valueText)}</td>
            </tr>`;
        })
        .join("");
      const cat = categoryScores[section.id];
      const photos = sectionPhotos[section.id] ?? [];
      return `
        <div style="margin:0 0 18px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
            <h3 style="margin:0 0 8px;color:var(--qa-primary);">${escapeHtml(section.label ?? "Section")}</h3>
            ${typeof cat === "number" ? `<span style="font-size:12px;color:#64748b;">Section score: <strong>${cat}%</strong></span>` : ""}
          </div>
          <table style="width:100%;border-collapse:collapse;">${rows || `<tr><td style="padding:8px 10px;color:#94a3b8;">No fields captured.</td></tr>`}</table>
          ${photos.length ? `<p style="margin:10px 0 0;font-size:12px;color:#64748b;">Inspector photos (${photos.length})</p>${photoGridHtml(photos, { annotations: tools?.mediaAnnotations })}` : ""}
        </div>`;
    })
    .join("");

  // ── Damage findings ────────────────────────────────────────────────────────
  const damageHtml = (tools?.damage ?? [])
    .filter((d) => (d.area || d.description || (d.photoKeys ?? []).length))
    .map((d) => {
      const tint = DAMAGE_TINT[d.severity] ?? "#fde68a";
      return `
        <div style="border:1px solid #e5e7eb;border-left:4px solid ${tint};border-radius:10px;padding:12px;margin:0 0 10px;background:#fff;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
            <strong style="color:#0f172a;">${escapeHtml(d.area || "Unspecified area")}</strong>
            <span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${tint};color:#7c2d12;font-size:11px;font-weight:700;">${escapeHtml(d.severity)}</span>
            ${d.estimatedCost != null ? `<span style="margin-left:auto;font-size:12px;color:#64748b;">Est. cost: <strong>$${escapeHtml(Number(d.estimatedCost).toFixed(2))}</strong></span>` : ""}
          </div>
          ${d.description ? `<p style="margin:8px 0 0;color:#334155;font-size:13px;">${escapeHtml(d.description)}</p>` : ""}
          ${photoGridHtml(d.photoKeys ?? [], { annotations: d.annotations })}
        </div>`;
    })
    .join("");

  // ── Next clean / restock / inventory / rework ───────────────────────────────
  const nextCleanHtml = (tools?.nextClean ?? [])
    .map(
      (r) =>
        `<li style="margin:0 0 6px;color:#334155;"><strong>${r.kind === "DEEP_CLEAN_AREA" ? `Deep clean — ${escapeHtml(r.area || "area")}` : "Special request"}:</strong> ${escapeHtml(r.note)}</li>`
    )
    .join("");

  const restockHtml = (tools?.restock ?? [])
    .filter((l) => l.quantity > 0)
    .map((l) => `<li style="margin:0 0 6px;color:#334155;">Stock <code>${escapeHtml(l.propertyStockId)}</code> — qty ${escapeHtml(l.quantity)}${l.note ? ` (${escapeHtml(l.note)})` : ""}</li>`)
    .join("");

  const inventoryHtml = (tools?.inventoryCount ?? [])
    .map((l) => `<li style="margin:0 0 6px;color:#334155;">Stock <code>${escapeHtml(l.propertyStockId)}</code> — counted ${escapeHtml(l.countedOnHand)}${l.note ? ` (${escapeHtml(l.note)})` : ""}</li>`)
    .join("");

  const rework = tools?.rework;
  const reworkHtml =
    rework && rework.enabled
      ? `
        <div class="qa-card">
          <h3 style="margin:0 0 8px;color:var(--qa-primary);">Rework note</h3>
          <p style="margin:0;color:#334155;font-size:13px;"><strong>${escapeHtml(rework.severity)}</strong> — ${escapeHtml(rework.reason || "—")}</p>
          ${rework.areas?.length ? `<p style="margin:8px 0 0;font-size:12px;color:#64748b;">Areas redone: ${escapeHtml(rework.areas.join(", "))}</p>` : ""}
          <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Time reassigned: ${escapeHtml(rework.minutesFromCleaner)} min · Amount: $${escapeHtml(Number(rework.amountFromCleaner ?? 0).toFixed(2))}</p>
        </div>`
      : "";

  const score = qa?.score ?? submission?.score ?? null;
  const passed = qa?.passed ?? submission?.passed ?? null;
  const notes = (qa?.notes ?? submission?.notes ?? "").toString();

  // ── Inspector sign-off ──────────────────────────────────────────────────────
  const signOff = tools?.signOff ?? null;
  const signedAtLabel =
    signOff?.signedAt && Number.isFinite(new Date(signOff.signedAt).getTime())
      ? format(toZonedTime(new Date(signOff.signedAt), TZ), "dd MMM yyyy, h:mm a")
      : "";
  const signOffHtml =
    signOff && signOff.signatureKey
      ? `
        <h2>Inspector sign-off</h2>
        <div class="qa-card" style="display:flex;flex-wrap:wrap;align-items:center;gap:24px;">
          <div style="flex:0 0 auto;">
            <img src="${escapeHtml(keyUrl(signOff.signatureKey))}" alt="Inspector signature" style="height:80px;max-width:260px;object-fit:contain;border-bottom:1px solid #cbd5e1;padding-bottom:4px;" />
            <p style="margin:6px 0 0;font-size:12px;color:#64748b;"><strong style="color:#0f172a;">${escapeHtml(signOff.signedByName || inspector)}</strong>${signedAtLabel ? ` · ${escapeHtml(signedAtLabel)}` : ""}</p>
          </div>
          ${signOff.attested ? `<p style="flex:1 1 220px;min-width:200px;margin:0;font-size:12px;color:#334155;">&#10003; The inspector attested that this QA inspection is accurate and complete, and was carried out by them.</p>` : ""}
        </div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Quality Inspection Report — ${escapeHtml(job.jobNumber ?? job.id)}</title>
<style>
  :root { --qa-primary: hsl(222 47% 25%); --qa-accent: hsl(199 89% 42%); }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 40px; }
  .qa-header { display:flex; align-items:center; gap:16px; padding-bottom:16px; border-bottom:3px solid var(--qa-primary); margin-bottom:20px; }
  .qa-header img { max-width:160px; max-height:60px; object-fit:contain; background:#ffffff; border-radius:8px; padding:5px; }
  .qa-header h1 { margin:0; font-size:24px; color:var(--qa-primary); }
  .qa-header p { margin:2px 0 0; font-size:13px; color:#64748b; }
  .qa-summary { display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:22px; }
  .qa-summary .k { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#94a3b8; }
  .qa-summary .v { font-size:15px; font-weight:600; color:#0f172a; }
  .badge { display:inline-block; padding:4px 12px; border-radius:9999px; font-size:13px; font-weight:700; }
  .pass { background:#dcfce7; color:#15803d; }
  .fail { background:#fee2e2; color:#dc2626; }
  h2 { color:var(--qa-primary); font-size:17px; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 14px; }
  h3 { font-size:15px; }
  .qa-card { border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin:0 0 14px; background:#fff; }
  ul { margin:0; padding-left:18px; font-size:13px; }
  code { background:#f1f5f9; padding:1px 4px; border-radius:4px; font-size:12px; }
  footer { margin-top:36px; font-size:11px; color:#94a3b8; border-top:1px solid #e5e7eb; padding-top:12px; }
</style>
</head>
<body>
  <div class="qa-header">
    ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(companyName)} logo" />` : ""}
    <div>
      <h1>Quality Inspection Report</h1>
      <p>${escapeHtml(companyName)}</p>
    </div>
  </div>

  <div class="qa-summary">
    <div><div class="k">Property</div><div class="v">${escapeHtml(job.property?.name ?? "Property")}</div></div>
    <div><div class="k">Job number</div><div class="v">${escapeHtml(job.jobNumber ?? job.id)}</div></div>
    <div><div class="k">Address</div><div class="v">${escapeHtml(`${job.property?.address ?? ""}${job.property?.suburb ? `, ${job.property.suburb}` : ""}`)}</div></div>
    <div><div class="k">Date</div><div class="v">${escapeHtml(localDate)}</div></div>
    <div><div class="k">Inspector</div><div class="v">${escapeHtml(inspector)}</div></div>
    <div><div class="k">Cleaners</div><div class="v">${escapeHtml(cleaners)}</div></div>
    <div><div class="k">Time on site</div><div class="v">${onSiteMinutes != null ? `${escapeHtml(onSiteMinutes)} min` : "—"}</div></div>
    <div><div class="k">Result</div><div class="v">${
      score != null
        ? `<span class="badge ${passed ? "pass" : "fail"}">${Number(score).toFixed(0)}% — ${passed ? "PASSED" : "FAILED"}</span>`
        : "—"
    }</div></div>
  </div>

  ${
    submission
      ? `<h2>Checklist results</h2>${sectionsHtml || `<p style="color:#94a3b8;">No QA checklist captured.</p>`}`
      : `<p style="color:#94a3b8;">No QA submission recorded for this job yet.</p>`
  }

  ${
    damageHtml
      ? `<h2>Damage findings</h2>${damageHtml}`
      : ""
  }

  ${
    nextCleanHtml
      ? `<h2>Next-clean requests</h2><div class="qa-card"><ul>${nextCleanHtml}</ul></div>`
      : ""
  }

  ${
    restockHtml
      ? `<h2>Restock requests</h2><div class="qa-card"><ul>${restockHtml}</ul></div>`
      : ""
  }

  ${
    inventoryHtml
      ? `<h2>Inventory counts</h2><div class="qa-card"><ul>${inventoryHtml}</ul></div>`
      : ""
  }

  ${reworkHtml ? `<h2>Rework</h2>${reworkHtml}` : ""}

  ${
    notes.trim()
      ? `<h2>QA inspector notes</h2><div class="qa-card"><p style="margin:0;white-space:pre-wrap;color:#334155;font-size:13px;">${escapeHtml(notes)}</p></div>`
      : ""
  }

  ${signOffHtml}

  <footer>Generated by ${escapeHtml(companyName)} — Quality Inspection Report · ${new Date().toISOString()}</footer>
</body>
</html>`;

  return { html, jobNumber: String(job.jobNumber ?? job.id) };
}
