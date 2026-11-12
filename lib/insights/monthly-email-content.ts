/**
 * The monthly Insights email body, built ONLY from the Business tab's payload
 * (`getBusinessInsights`), so the figures, exclusions and "Not enough data"
 * wording are the page's own. A payload built without finance access carries
 * no money cards and no money findings, so a recipient without finance access
 * gets no financial figures; this builder also leaves the Money section out.
 *
 * Pure: tests render it directly.
 */
import { escapeHtml } from "@/lib/utils/escape-html";
import type { BusinessPayload } from "./business";
import { basisText, formatAud, formatPct } from "./format";
import type { InsightsEmailSection } from "./monthly-email-settings";
import type { MeasureWithDelta } from "./types";

type Row = { label: string; measure: MeasureWithDelta; format: "aud" | "pct" | "count"; basis: string };

function figure(measure: MeasureWithDelta, format: Row["format"]): string {
  if (measure.value === null) return `Not enough data${measure.reason ? ` (${measure.reason})` : ""}`;
  if (format === "aud") return formatAud(measure.value);
  if (format === "pct") return formatPct(measure.value);
  return String(measure.value);
}

function change(measure: MeasureWithDelta): string {
  if (measure.delta === null) return "No comparison";
  const sign = measure.delta > 0 ? "+" : "";
  if (measure.deltaKind === "percent") return `${sign}${measure.delta}% on the previous period`;
  if (measure.deltaKind === "points") return `${sign}${measure.delta} points on the previous period`;
  return `${sign}${measure.delta} on the previous period`;
}

function rowHtml(row: Row): string {
  return `<tr>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;"><strong>${escapeHtml(row.label)}</strong><br><span style="color:#666;font-size:12px;">${escapeHtml(row.basis)}</span></td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;white-space:nowrap;">${escapeHtml(figure(row.measure, row.format))}<br><span style="color:#666;font-size:12px;">${escapeHtml(change(row.measure))}</span></td>
  </tr>`;
}

function sectionHtml(title: string, rows: Row[]): string {
  if (rows.length === 0) return "";
  return `<h2 style="font-size:16px;margin:24px 0 8px;">${escapeHtml(title)}</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows.map(rowHtml).join("")}</table>`;
}

export type InsightsEmailContent = { subject: string; html: string; text: string };

export function buildInsightsEmail(input: {
  payload: BusinessPayload;
  sections: readonly InsightsEmailSection[];
  recipientName: string | null;
  companyName: string;
  insightsUrl: string;
  /** "October 2026", or "November 2026 so far" for the test send. */
  periodLabel: string;
  test?: boolean;
}): InsightsEmailContent {
  const { payload, sections } = input;
  const cards = payload.cards;
  const want = (section: InsightsEmailSection) => sections.includes(section);
  const parts: string[] = [];
  const lines: string[] = [];

  if (want("money") && payload.access.finance && cards.revenue && cards.margin) {
    const split = cards.revenueSplit;
    const revenueBasis = split
      ? `${formatAud(split.invoiced)} invoiced (ex GST, net of credit notes); ${formatAud(split.notYetInvoiced)} not yet invoiced (at current rates). ${basisText(cards.revenue)}.`
      : basisText(cards.revenue);
    const money: Row[] = [
      { label: "Revenue", measure: cards.revenue, format: "aud", basis: revenueBasis },
      { label: "Gross margin", measure: cards.margin, format: "pct", basis: `(Revenue − cleaner pay) ÷ revenue. ${basisText(cards.margin)}.` },
    ];
    parts.push(sectionHtml("Money", money));
    for (const row of money) lines.push(`${row.label}: ${figure(row.measure, row.format)} (${row.basis})`);
  }
  if (want("work")) {
    const work: Row[] = [
      { label: "Cleans done", measure: cards.cleans, format: "count", basis: "Submitted, in QA, completed or invoiced cleans scheduled in the period." },
      { label: "On time", measure: cards.onTime, format: "pct", basis: `First clock-in within 15 minutes of the scheduled start. ${basisText(cards.onTime)}.` },
      { label: "Actual vs planned hours", measure: cards.hoursRatio, format: "pct", basis: `Logged hours ÷ allocated hours. ${basisText(cards.hoursRatio)}.` },
    ];
    parts.push(sectionHtml("Work", work));
    for (const row of work) lines.push(`${row.label}: ${figure(row.measure, row.format)}`);
  }
  if (want("quality")) {
    const quality: Row[] = [{ label: "Rework rate", measure: cards.reworkRate, format: "pct", basis: `Rework jobs ÷ cleans. ${basisText(cards.reworkRate)}.` }];
    parts.push(sectionHtml("Quality", quality));
    lines.push(`Rework rate: ${figure(cards.reworkRate, "pct")}`);
  }
  if (want("findings")) {
    const items = payload.findings.length
      ? payload.findings.map((finding) => `<li style="margin-bottom:8px;"><strong>${escapeHtml(finding.headline)}</strong> ${escapeHtml(finding.detail)}<br><span style="color:#666;font-size:12px;">${escapeHtml(finding.basis)}</span></li>`).join("")
      : "<li>Nothing notable this period.</li>";
    parts.push(`<h2 style="font-size:16px;margin:24px 0 8px;">Worth knowing</h2><ul style="padding-left:18px;font-size:14px;">${items}</ul>`);
    lines.push(...(payload.findings.length ? payload.findings.map((finding) => `- ${finding.headline}`) : ["Nothing notable this period."]));
  }

  const greeting = input.recipientName ? `Hi ${escapeHtml(input.recipientName)},` : "Hello,";
  const prefix = input.test ? "Test: " : "";
  const subject = `${prefix}${input.companyName} business summary: ${input.periodLabel}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:640px;">
  ${input.test ? `<p style="background:#fff7e0;padding:8px 12px;">Test send to you only. The period is not finished, so figures will change.</p>` : ""}
  <p>${greeting}</p>
  <p>Your business summary for <strong>${escapeHtml(input.periodLabel)}</strong>, from Insights. Every figure shows what it counts; a figure without enough records says so instead of showing a number.</p>
  ${parts.join("\n")}
  <p style="margin-top:24px;"><a href="${escapeHtml(input.insightsUrl)}">Open Insights</a></p>
  ${payload.access.finance ? "" : `<p style="color:#666;font-size:12px;">Money figures are left out because your account does not have finance access.</p>`}
</div>`;
  return { subject, html, text: [subject, ...lines].join("\n") };
}
