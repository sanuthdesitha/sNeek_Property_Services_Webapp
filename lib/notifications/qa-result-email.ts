import { buildDesignedEmail } from "@/lib/email-design/build-email";

/**
 * The QA result email a cleaner actually receives.
 *
 * What this replaces: a two-line stub reading "This clean did not pass
 * inspection." plus a bare count ("Issues: 2 major, 1 minor"). It named not one
 * actual issue — no category, no description, no photo, no explanation of the
 * score — so a cleaner learned they had failed and nothing about what to fix.
 * Everything needed was already computed at submit time and thrown away.
 *
 * Pure by design (no DB, no I/O, no `new Date()`): the caller gathers the facts,
 * this turns them into subject + HTML + plain text. That makes the content
 * testable without a database, which matters because this is the message that
 * carries bad news to a person about their own work.
 */

export interface QaResultEmailIssue {
  severity: "MINOR" | "MAJOR" | "CRITICAL" | string;
  /** Graded "Fail" (current scale; stored severity MAJOR, or CRITICAL when serious). */
  failVerdict?: boolean;
  /** A Fail the inspector marked Serious. */
  serious?: boolean;
  /** Admin-configured label, e.g. "Bed setup & linen" — never a raw key. */
  categoryLabel: string;
  description: string;
  guestReadyImpact?: boolean;
  /** Flattened annotated photo (QA's markup already burned in). */
  photoUrl?: string | null;
}

export interface QaResultEmailInput {
  companyName: string;
  propertyName?: string | null;
  jobNumber?: string | null;
  /** Pre-formatted for the reader's locale by the caller. */
  jobDateLabel?: string | null;
  score: number;
  /** EXCELLENT | PASS | NEEDS_IMPROVEMENT | FAILED | MANAGEMENT_REVIEW */
  rating?: string | null;
  passed: boolean;
  issues: QaResultEmailIssue[];
  /**
   * Deduction per severity, FROM SETTINGS. Hardcoding 3/10/25 would become a
   * lie the moment an admin retunes them, and this email is the one place a
   * cleaner sees the arithmetic behind a number that affects their standing.
   */
  deductions?: {
    minor?: number;
    major?: number;
    critical?: number;
    fail?: number;
    seriousFail?: number;
  } | null;
  /** The inspector's cleaner-facing coaching note, if they wrote one. */
  coachingNote?: string | null;
  /** Where to read the full feedback. */
  qualityUrl: string;
  /** Optional deep link to download their copy of the report. */
  reportUrl?: string | null;
  managementReview?: boolean;
}

const RATING_LABEL: Record<string, string> = {
  EXCELLENT: "Excellent",
  PASS: "Pass",
  NEEDS_IMPROVEMENT: "Needs improvement",
  FAILED: "Failed",
  MANAGEMENT_REVIEW: "Management review",
};

const SEVERITY_STYLE: Record<string, { bg: string; ink: string; label: string }> = {
  MINOR: { bg: "#fef3c7", ink: "#92400e", label: "Minor" },
  MAJOR: { bg: "#fed7aa", ink: "#9a3412", label: "Major" },
  CRITICAL: { bg: "#fecaca", ink: "#991b1b", label: "Critical" },
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fail and serious Fail read as graded; Major / Critical only for history. */
function issueStyle(issue: QaResultEmailIssue): { bg: string; ink: string; label: string } {
  if (issue.failVerdict) {
    return issue.serious
      ? { ...SEVERITY_STYLE.CRITICAL, label: "Fail · serious" }
      : { ...SEVERITY_STYLE.CRITICAL, label: "Fail" };
  }
  return SEVERITY_STYLE[String(issue.severity).toUpperCase()] ?? SEVERITY_STYLE.MINOR;
}

function countBySeverity(issues: QaResultEmailIssue[]) {
  return issues.reduce(
    (acc, i) => {
      const key = String(i.severity).toUpperCase();
      if (i.failVerdict) {
        if (i.serious) acc.SERIOUS_FAIL += 1;
        else acc.FAIL += 1;
      } else if (key === "MINOR" || key === "MAJOR" || key === "CRITICAL") acc[key] += 1;
      return acc;
    },
    { MINOR: 0, FAIL: 0, SERIOUS_FAIL: 0, MAJOR: 0, CRITICAL: 0 }
  );
}

/**
 * A short, concrete "what to work on next" line derived from the findings.
 *
 * Deliberately mechanical rather than clever: it names the categories that
 * actually recurred in THIS inspection, so the advice is specific and can't
 * drift into generic filler.
 */
export function buildImprovementFocus(issues: QaResultEmailIssue[]): string[] {
  const byCategory = new Map<string, number>();
  for (const i of issues) {
    byCategory.set(i.categoryLabel, (byCategory.get(i.categoryLabel) ?? 0) + 1);
  }
  return Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => (count > 1 ? `${label} (${count} findings)` : label));
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

export function buildQaResultEmail(input: QaResultEmailInput): BuiltEmail {
  const counts = countBySeverity(input.issues);
  const ratingLabel = input.rating ? RATING_LABEL[input.rating] ?? input.rating : null;
  const where = input.propertyName ? ` — ${input.propertyName}` : "";
  const score = Math.round(input.score);

  const subject = input.passed
    ? `${input.companyName}: QA passed (${score}%)${where}`
    : `${input.companyName}: QA needs attention (${score}%)${where}`;

  // ── Score arithmetic, shown rather than asserted ──────────────────────────
  const rows = [
    { label: "Minor", count: counts.MINOR, each: input.deductions?.minor },
    { label: "Fail", count: counts.FAIL, each: input.deductions?.fail },
    { label: "Fail · serious", count: counts.SERIOUS_FAIL, each: input.deductions?.seriousFail },
    { label: "Major", count: counts.MAJOR, each: input.deductions?.major },
    { label: "Critical", count: counts.CRITICAL, each: input.deductions?.critical },
  ].filter((r) => r.count > 0);

  // Built fragments for the "qaResult" design (lib/email-design). Every value
  // is escaped here; the sn-* classes let the dark palette apply to them too.
  const cell = "padding:6px 0;border-bottom:1px solid #E4DED2;font-size:14px;line-height:1.5";
  const breakdownHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
        <tr>
          <th align="left" class="sn-mu sn-ln" style="${cell};font-size:11.5px;font-weight:600;color:#5B6660">Finding</th>
          <th align="right" class="sn-mu sn-ln" style="${cell};font-size:11.5px;font-weight:600;color:#5B6660">Count</th>
          <th align="right" class="sn-mu sn-ln" style="${cell};font-size:11.5px;font-weight:600;color:#5B6660">Effect</th>
        </tr>
        ${rows
          .map(
            (r) => `<tr>
              <td class="sn-tx sn-ln" style="${cell};color:#36423C">${esc(r.label)}</td>
              <td align="right" class="sn-tx sn-ln" style="${cell};color:#36423C">${r.count}</td>
              <td align="right" class="sn-tx sn-ln" style="${cell};color:#36423C">${
                r.each != null ? `&minus;${esc(r.count * r.each)}` : "&mdash;"
              }</td>
            </tr>`
          )
          .join("")}
      </table>`
    : "";

  const issuesHtml = input.issues
    .map((issue) => {
      const style = issueStyle(issue);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sn-ln" style="border-collapse:separate;border:1px solid #E4DED2;border-radius:8px;margin:0 0 10px"><tr><td style="padding:10px 14px">
            <span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${style.bg};color:${style.ink};font-size:11px;font-weight:700">${esc(style.label)}</span>
            <strong class="sn-ink" style="margin-left:6px;color:#17221D;font-size:14px">${esc(issue.categoryLabel)}</strong>
            ${
              issue.guestReadyImpact
                ? `<span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:999px;background:#FBF0D9;color:#6A4710;font-size:11px;font-weight:700">Guest-ready impact</span>`
                : ""
            }
            <p class="sn-tx" style="margin:6px 0 0;color:#36423C;font-size:14px;line-height:1.5">${esc(issue.description)}</p>
            ${
              issue.photoUrl
                ? `<img src="${esc(issue.photoUrl)}" width="260" alt="What the inspector marked" style="display:block;margin-top:8px;width:100%;max-width:260px;height:auto;border:0;border-radius:6px">`
                : ""
            }
          </td></tr></table>`;
    })
    .join("");

  const focus = buildImprovementFocus(input.issues);
  const headline = input.passed ? "Your clean passed inspection" : "Your clean needs attention";
  const jobLine = `${input.propertyName ?? "Your job"}${input.jobDateLabel ? ` · ${input.jobDateLabel}` : ""}${input.jobNumber ? ` · Job ${input.jobNumber}` : ""}`;
  const issuesText = input.issues.length
    ? input.issues.map((i) => `- [${i.failVerdict ? issueStyle(i).label.toUpperCase() : String(i.severity).toUpperCase()}] ${i.categoryLabel}: ${i.description}`).join("\n")
    : "No specific issues were recorded against this clean.";
  const designed = buildDesignedEmail({ companyName: input.companyName }, "qaResult", {
    headline,
    jobLine,
    scoreLabel: `${score}%`,
    ratingLabel: ratingLabel ?? "",
    resultLabel: input.passed ? "passed" : "needs attention",
    statusNote: input.managementReview ? "A critical finding means this inspection goes to management review." : "",
    breakdown: breakdownHtml,
    issuesList: issuesHtml
      ? `<p class="sn-ink" style="margin:0 0 8px;font-weight:600;color:#17221D">What was found</p>${issuesHtml}`
      : `<p class="sn-tx" style="margin:0;color:#36423C">No specific issues were recorded against this clean.</p>`,
    issuesText,
    focusLine: focus.join(", "),
    coachingNote: input.coachingNote ?? "",
    qualityUrl: input.qualityUrl,
    reportUrl: input.reportUrl ?? "",
    whereSuffix: where,
  });
  const html = designed.html;

  // Plain-text fallback carries the same substance — some cleaners read mail in
  // clients that strip HTML, and "you failed" with no detail is the defect.
  const textLines = [
    headline,
    `${input.propertyName ?? "Your job"}${input.jobDateLabel ? ` · ${input.jobDateLabel}` : ""}`,
    `Score ${score}%${ratingLabel ? ` (${ratingLabel})` : ""}`,
    "",
    ...(input.issues.length
      ? [
          "What was found:",
          ...input.issues.map(
            (i) =>
              `- [${i.failVerdict ? issueStyle(i).label.toUpperCase() : String(i.severity).toUpperCase()}] ${i.categoryLabel}: ${i.description}`
          ),
        ]
      : ["No specific issues were recorded against this clean."]),
    ...(focus.length ? ["", `What to focus on next: ${focus.join(", ")}`] : []),
    ...(input.coachingNote ? ["", input.coachingNote] : []),
    "",
    `See the full feedback: ${input.qualityUrl}`,
  ];

  return { subject: designed.subject || subject, html, text: textLines.join("\n") };
}
