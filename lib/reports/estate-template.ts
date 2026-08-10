// "Estate" — the modern job report skin. Consumes the pure view model from
// report-view-model.ts so the template stays thin (markup + CSS only).
//
// PDF constraints (Playwright Chromium, A4, printBackground: true — see
// lib/reports/pdf.ts): inline CSS only, no JS, no external font fetches.
// Modern CSS (grid/flex, break-inside) is fully supported by Chromium print.

import type {
  ReportFieldVM,
  ReportMediaVM,
  ReportSectionVM,
  ReportTaskVM,
  ReportViewModel,
} from "./report-view-model";

export type EstateRenderCtx = {
  headTags: string;
  primaryHsl: string;
  accentHsl: string;
  companyName: string;
  logoUrl: string;
  renderedTitle: string;
  photoDims: { w: number; h: number };
  showHeader: boolean;
  showSummary: boolean;
  showTaskChecklist: boolean;
  showGallery: boolean;
  showQaSummary: boolean;
  showSupplies: boolean;
  showFooter: boolean;
  customFooter: string;
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mediaGridHtml(media: ReportMediaVM[], klass = ""): string {
  if (!media.length) return "";
  const items = media
    .map((m) => {
      if (m.isVideo) {
        return `<a class="est-video" href="${esc(m.url)}" target="_blank" rel="noreferrer">▶ ${esc(m.caption)}${
          m.timestamp ? ` · ${esc(m.timestamp)}` : ""
        }</a>`;
      }
      return `<figure class="est-photo">
  <img src="${esc(m.url)}" alt="${esc(m.caption)}" />
  <figcaption>${esc(m.caption)}${m.timestamp ? `<span>${esc(m.timestamp)}</span>` : ""}</figcaption>
</figure>`;
    })
    .join("");
  return `<div class="est-media-grid ${klass}">${items}</div>`;
}

function ratingHtml(field: ReportFieldVM): string {
  if (!field.rating) return esc(field.value);
  const max = Math.max(1, Math.min(10, Math.round(field.rating.max)));
  const filled = Math.max(0, Math.min(max, Math.round(field.rating.value)));
  const dots = Array.from({ length: max }, (_, i) =>
    i < filled ? `<span class="est-dot on"></span>` : `<span class="est-dot"></span>`
  ).join("");
  return `<span class="est-rating">${dots}<span class="est-rating-n">${esc(field.value)}</span></span>`;
}

function fieldValueHtml(field: ReportFieldVM): string {
  switch (field.kind) {
    case "checkbox":
      return field.checked
        ? `<span class="est-tick yes">✓</span>`
        : `<span class="est-tick ${field.answered ? "no" : "na"}">${field.answered ? "✕" : "—"}</span>`;
    case "yesno": {
      const tone = field.yesNo === "yes" ? "good" : field.yesNo === "no" ? "bad" : "neutral";
      return field.answered
        ? `<span class="est-pill ${tone}">${esc(field.value)}</span>`
        : `<span class="est-muted">${esc(field.value)}</span>`;
    }
    case "rating":
      return field.answered ? ratingHtml(field) : `<span class="est-muted">—</span>`;
    case "signature":
      return field.signatureDataUrl
        ? `<img class="est-signature" src="${esc(field.signatureDataUrl)}" alt="${esc(field.label)}" />`
        : `<span class="est-muted">—</span>`;
    case "media":
      return field.answered
        ? `<span class="est-muted">${esc(field.value)}</span>`
        : `<span class="est-muted">Not uploaded</span>`;
    case "longtext":
      return field.answered
        ? `<div class="est-longtext">${esc(field.value)}</div>`
        : `<span class="est-muted">—</span>`;
    default:
      return field.answered ? esc(field.value) : `<span class="est-muted">—</span>`;
  }
}

function sectionHtml(section: ReportSectionVM): string {
  const rows = section.fields
    .map((field) => {
      if (field.kind === "instruction") {
        return field.value
          ? `<div class="est-instruction">${esc(field.value)}</div>`
          : "";
      }
      const media = mediaGridHtml(field.media);
      return `<div class="est-row${field.isChild ? " child" : ""}">
  <div class="est-row-label">${esc(field.label)}</div>
  <div class="est-row-value">${fieldValueHtml(field)}</div>
</div>${media}`;
    })
    .join("");

  const progress =
    section.answerableCount > 0
      ? `<span class="est-progress">${section.answeredCount}/${section.answerableCount} completed${
          section.photoCount > 0 ? ` · ${section.photoCount} photo${section.photoCount === 1 ? "" : "s"}` : ""
        }</span>`
      : "";

  return `<section class="est-card">
  <header class="est-card-head">
    <h2>${esc(section.label)}</h2>
    ${progress}
  </header>
  ${rows}
</section>`;
}

function tasksHtml(title: string, tasks: ReportTaskVM[]): string {
  if (!tasks.length) return "";
  const items = tasks
    .map(
      (t) => `<div class="est-task">
  <div class="est-task-main">
    <div class="est-task-title">${esc(t.title)}
      <span class="est-pill ${t.statusTone === "good" ? "good" : t.statusTone === "bad" ? "bad" : "neutral"}">${esc(t.statusLabel)}</span>
    </div>
    ${t.description ? `<div class="est-task-desc">${esc(t.description)}</div>` : ""}
    ${t.note ? `<div class="est-task-note"><strong>${esc(t.noteLabel)}:</strong> ${esc(t.note)}</div>` : ""}
    ${t.meta ? `<div class="est-task-meta">${esc(t.meta)}</div>` : ""}
  </div>
  ${mediaGridHtml(t.media)}
</div>`
    )
    .join("");
  return `<section class="est-card">
  <header class="est-card-head"><h2>${esc(title)}</h2></header>
  ${items}
</section>`;
}

function qaHtml(vm: ReportViewModel): string {
  const qa = vm.qa;
  if (!qa) return "";
  const badge =
    qa.score != null
      ? `<span class="est-pill ${qa.passed ? "good" : "bad"}">${qa.score.toFixed(0)}% · ${qa.passed ? "PASSED" : "FAILED"}</span>`
      : "";
  const damage = qa.damage.length
    ? `<div class="est-subhead">Damage findings</div>
<table class="est-table">
  <thead><tr><th>Area</th><th>Severity</th><th>Detail</th></tr></thead>
  <tbody>${qa.damage
    .map(
      (d) =>
        `<tr><td>${esc(d.area)}</td><td>${esc(d.severity)}</td><td>${esc(d.description)}</td></tr>`
    )
    .join("")}</tbody>
</table>`
    : "";
  const photos = qa.photoUrls.length
    ? `<div class="est-subhead">Inspection photos</div>
<div class="est-media-grid">${qa.photoUrls
        .map(
          (url) =>
            `<figure class="est-photo"><img src="${esc(url)}" alt="QA inspection photo" /><figcaption>Quality inspection</figcaption></figure>`
        )
        .join("")}</div>`
    : "";
  return `<section class="est-card">
  <header class="est-card-head"><h2>Quality inspection</h2>${badge}</header>
  ${qa.notes ? `<div class="est-longtext">${esc(qa.notes)}</div>` : ""}
  ${damage}
  ${photos}
</section>`;
}

function extrasHtml(vm: ReportViewModel, showSupplies: boolean): string {
  const parts: string[] = [];

  if (vm.isRework && (vm.reworkReason || vm.reworkAreas.length)) {
    const areas = vm.reworkAreas
      .map(
        (a) => `<div class="est-row">
  <div class="est-row-label">${esc(a.label)}</div>
  <div class="est-row-value">${a.note ? esc(a.note) : `<span class="est-muted">Flagged for re-clean</span>`}</div>
</div>${
          a.photoUrls.length
            ? `<div class="est-media-grid">${a.photoUrls
                .map(
                  (url) =>
                    `<figure class="est-photo"><img src="${esc(url)}" alt="${esc(a.label)}" /><figcaption>${esc(a.label)} — flagged</figcaption></figure>`
                )
                .join("")}</div>`
            : ""
        }`
      )
      .join("");
    parts.push(`<section class="est-card">
  <header class="est-card-head"><h2>Rework — flagged areas</h2></header>
  ${vm.reworkReason ? `<div class="est-longtext">${esc(vm.reworkReason)}</div>` : ""}
  ${areas}
</section>`);
  }

  if (vm.laundry) {
    parts.push(`<section class="est-card">
  <header class="est-card-head"><h2>Laundry</h2></header>
  <div class="est-row"><div class="est-row-label">Laundry ready</div><div class="est-row-value">${esc(vm.laundry.readyLabel)}</div></div>
  ${vm.laundry.outcome ? `<div class="est-row"><div class="est-row-label">Outcome</div><div class="est-row-value">${esc(vm.laundry.outcome)}</div></div>` : ""}
  ${vm.laundry.bagLocation ? `<div class="est-row"><div class="est-row-label">Bag location</div><div class="est-row-value">${esc(vm.laundry.bagLocation)}</div></div>` : ""}
  ${vm.laundry.skipReason ? `<div class="est-row"><div class="est-row-label">Skip reason</div><div class="est-row-value">${esc(vm.laundry.skipReason)}</div></div>` : ""}
</section>`);
  }

  if (showSupplies && vm.stockUsed.length) {
    parts.push(`<section class="est-card">
  <header class="est-card-head"><h2>Supplies used</h2></header>
  ${vm.stockUsed
    .map(
      (s) =>
        `<div class="est-row"><div class="est-row-label">${esc(s.name)}</div><div class="est-row-value">${esc(String(s.quantity))}</div></div>`
    )
    .join("")}
</section>`);
  }

  if (vm.selfInspectionIncomplete.length) {
    parts.push(`<section class="est-card">
  <header class="est-card-head"><h2>Self-inspection</h2><span class="est-pill bad">Incomplete</span></header>
  <div class="est-longtext">${vm.selfInspectionIncomplete.length} self-inspection item${
    vm.selfInspectionIncomplete.length === 1 ? "" : "s"
  } left unticked at submission.</div>
</section>`);
  }

  return parts.join("\n");
}

export function renderEstateReport(vm: ReportViewModel, c: EstateRenderCtx): string {
  const sans = `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

  const statsHtml = vm.stats
    .map(
      (s) => `<div class="est-stat">
  <div class="est-stat-label">${esc(s.label)}</div>
  <div class="est-stat-value">${esc(s.value)}</div>
  ${s.sub ? `<div class="est-stat-sub">${esc(s.sub)}</div>` : ""}
</div>`
    )
    .join("");

  const flagsHtml = vm.flags.length
    ? `<div class="est-flags">${vm.flags
        .map((f) => `<span class="est-flag ${f.tone}">${esc(f.label)}</span>`)
        .join("")}</div>`
    : "";

  const header = c.showHeader
    ? `<header class="est-cover">
  <div class="est-cover-brand">
    ${c.logoUrl ? `<img src="${esc(c.logoUrl)}" alt="${esc(c.companyName)} logo" />` : `<span class="est-cover-company">${esc(c.companyName)}</span>`}
    <span class="est-cover-eyebrow">${esc(c.renderedTitle)}</span>
  </div>
  <h1>${esc(vm.propertyName || c.renderedTitle)}</h1>
  <p class="est-cover-sub">${esc(vm.propertyAddress)}</p>
  <div class="est-cover-meta">
    <span>${esc(vm.dateLabel)}</span>
    <span>${esc(vm.jobTypeLabel)}${vm.isRework ? " · Rework" : ""}</span>
    <span>Job ${esc(vm.jobNumber)}</span>
    ${vm.cleaners.length ? `<span>Cleaned by ${esc(vm.cleaners.join(", "))}</span>` : ""}
  </div>
</header>`
    : "";

  // Clock truth line: TimeLog clock-in/out only. When the cleaner never
  // clocked out we say so — the submission time is NOT a clock-out and is kept
  // on its own labelled "Submitted" line below.
  const clockLine =
    vm.clockInLabel || vm.clockOutLabel || vm.clockOutMissing
      ? `<div class="est-clock"><strong>Clock-in:</strong> ${esc(vm.clockInLabel ?? "not recorded")} · <strong>Clock-out:</strong> ${esc(
          vm.clockOutLabel ?? "not clocked out"
        )}${vm.clockDurationLabel ? ` · ${esc(vm.clockDurationLabel)} on site` : ""}</div>`
      : "";

  const summary = c.showSummary
    ? `<section class="est-summary">
  <div class="est-stats">${statsHtml}</div>
  ${flagsHtml}
  ${clockLine}
  <div class="est-submitted">Submitted by ${esc(vm.submittedBy)}${
    vm.submittedAtLabel ? ` · form submitted ${esc(vm.submittedAtLabel)}` : ""
  }</div>
</section>`
    : "";

  const checklist = c.showTaskChecklist
    ? [
        tasksHtml("Priority job tasks", vm.jobTasks),
        tasksHtml("Admin requested tasks", vm.adminTasks),
        vm.sections.length
          ? vm.sections.map(sectionHtml).join("\n")
          : `<section class="est-card"><header class="est-card-head"><h2>Checklist</h2></header><div class="est-longtext">No checklist values captured.</div></section>`,
      ].join("\n")
    : "";

  const gallery =
    c.showGallery && vm.extraMedia.length
      ? `<section class="est-card">
  <header class="est-card-head"><h2>Additional evidence</h2></header>
  ${mediaGridHtml(vm.extraMedia)}
</section>`
      : "";

  const footer = c.showFooter
    ? `<footer class="est-footer">${
        c.customFooter || `${esc(c.companyName)} · Report generated ${esc(new Date().toISOString())}`
      }</footer>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
${c.headTags}
<style>
  :root {
    --primary: hsl(${c.primaryHsl});
    --accent: hsl(${c.accentHsl});
    --ink: #17202b;
    --muted: #6b7280;
    --line: #e7e9ee;
    --bg-soft: #f7f8fa;
  }
  * { box-sizing: border-box; }
  @page { margin: 14mm 12mm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${sans};
    color: var(--ink);
    max-width: 960px;
    margin: 0 auto;
    font-size: 13px;
    line-height: 1.55;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Cover */
  .est-cover { padding: 34px 36px 28px; background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 94%, #000) 0%, var(--primary) 60%); color: #fff; border-radius: 0 0 18px 18px; }
  .est-cover-brand { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
  .est-cover-brand img { max-height: 44px; max-width: 170px; object-fit: contain; }
  .est-cover-company { font-weight: 700; letter-spacing: 0.06em; }
  .est-cover-eyebrow { font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.85; }
  .est-cover h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -0.01em; }
  .est-cover-sub { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
  .est-cover-meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 16px; font-size: 12px; opacity: 0.95; }

  /* Summary */
  .est-summary { margin: 22px 0; break-inside: avoid; }
  .est-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .est-stat { border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; background: #fff; }
  .est-stat-label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .est-stat-value { font-size: 20px; font-weight: 700; margin-top: 4px; color: var(--primary); }
  .est-stat-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .est-flags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .est-flag { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .est-flag.warn { background: #fef3c7; color: #92400e; }
  .est-flag.info { background: #e0ecff; color: #1d4ed8; }
  .est-flag.good { background: #dcfce7; color: #166534; }
  .est-clock { margin-top: 12px; font-size: 12px; color: var(--ink); }
  .est-clock strong { color: var(--primary); font-weight: 600; }
  .est-submitted { margin-top: 4px; font-size: 12px; color: var(--muted); }

  /* Cards */
  .est-card { border: 1px solid var(--line); border-radius: 16px; background: #fff; padding: 18px 22px 16px; margin: 0 0 16px; break-inside: avoid-page; }
  .est-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 2px solid color-mix(in srgb, var(--accent) 55%, #fff); padding-bottom: 8px; margin-bottom: 6px; }
  .est-card-head h2 { margin: 0; font-size: 16px; letter-spacing: -0.01em; color: var(--primary); }
  .est-progress { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .est-subhead { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-top: 14px; }

  /* Field rows */
  .est-row { display: grid; grid-template-columns: 1fr 1.1fr; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--bg-soft); break-inside: avoid; }
  .est-row:last-child { border-bottom: 0; }
  .est-row.child { padding-left: 18px; }
  .est-row.child .est-row-label { color: var(--muted); }
  .est-row-label { font-weight: 500; }
  .est-row-value { text-align: right; }
  .est-longtext { white-space: pre-wrap; background: var(--bg-soft); border-radius: 10px; padding: 10px 12px; margin: 8px 0; text-align: left; }
  .est-row-value .est-longtext { text-align: left; }
  .est-muted { color: var(--muted); }
  .est-instruction { font-size: 12px; color: var(--muted); font-style: italic; padding: 6px 0; }

  .est-tick { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; font-size: 13px; font-weight: 700; }
  .est-tick.yes { background: #dcfce7; color: #166534; }
  .est-tick.no { background: #fee2e2; color: #991b1b; }
  .est-tick.na { background: var(--bg-soft); color: var(--muted); }

  .est-pill { display: inline-block; padding: 3px 11px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
  .est-pill.good { background: #dcfce7; color: #166534; }
  .est-pill.bad { background: #fee2e2; color: #991b1b; }
  .est-pill.neutral { background: var(--bg-soft); color: var(--muted); }

  .est-rating { display: inline-flex; align-items: center; gap: 3px; }
  .est-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--line); display: inline-block; }
  .est-dot.on { background: var(--accent); }
  .est-rating-n { margin-left: 6px; font-size: 11px; color: var(--muted); }

  .est-signature { width: 220px; height: 90px; object-fit: contain; border: 1px solid var(--line); border-radius: 10px; background: #fff; padding: 6px; }

  /* Media */
  .est-media-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${c.photoDims.w}px, 1fr)); gap: 12px; margin: 10px 0 6px; }
  .est-photo { margin: 0; break-inside: avoid; }
  .est-photo img { width: 100%; height: ${c.photoDims.h}px; object-fit: cover; border-radius: 12px; border: 1px solid var(--line); display: block; }
  .est-photo figcaption { font-size: 10px; color: var(--muted); margin-top: 4px; line-height: 1.35; }
  .est-photo figcaption span { display: block; }
  .est-video { display: inline-block; padding: 8px 12px; background: var(--bg-soft); border-radius: 10px; font-size: 11px; color: var(--primary); text-decoration: none; break-inside: avoid; }

  /* Tasks */
  .est-task { padding: 10px 0; border-bottom: 1px solid var(--bg-soft); break-inside: avoid; }
  .est-task:last-child { border-bottom: 0; }
  .est-task-title { font-weight: 600; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .est-task-desc { font-size: 12px; color: var(--muted); margin-top: 3px; }
  .est-task-note { font-size: 12px; margin-top: 6px; }
  .est-task-meta { font-size: 11px; color: var(--muted); margin-top: 4px; }

  .est-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  .est-table th { font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); }
  .est-table td { padding: 8px 10px; border-bottom: 1px solid var(--bg-soft); vertical-align: top; }

  .est-footer { margin: 26px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); text-align: center; }

  /* Screen-only responsiveness (harmless in print) */
  @media screen and (max-width: 720px) {
    .est-stats { grid-template-columns: repeat(2, 1fr); }
    .est-row { grid-template-columns: 1fr; gap: 2px; }
    .est-row-value { text-align: left; }
    .est-cover { border-radius: 0; }
  }
</style>
</head>
<body>
${header}
${summary}
${checklist}
${c.showQaSummary ? qaHtml(vm) : ""}
${extrasHtml(vm, c.showSupplies)}
${gallery}
${footer}
</body>
</html>`;
}
