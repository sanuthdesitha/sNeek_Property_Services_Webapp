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
  deductions?: { minor?: number; major?: number; critical?: number } | null;
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

function countBySeverity(issues: QaResultEmailIssue[]) {
  return issues.reduce(
    (acc, i) => {
      const key = String(i.severity).toUpperCase();
      if (key === "MINOR" || key === "MAJOR" || key === "CRITICAL") acc[key] += 1;
      return acc;
    },
    { MINOR: 0, MAJOR: 0, CRITICAL: 0 }
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
    { label: "Major", count: counts.MAJOR, each: input.deductions?.major },
    { label: "Critical", count: counts.CRITICAL, each: input.deductions?.critical },
  ].filter((r) => r.count > 0);

  const breakdownHtml = rows.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 0;">
        <tr>
          <th align="left" style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Finding</th>
          <th align="right" style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Count</th>
          <th align="right" style="padding:5px 8px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.06em;">Effect</th>
        </tr>
        ${rows
          .map(
            (r) => `<tr>
              <td style="padding:6px 8px;border-bottom:1px solid #f1f3f2;color:#374151;">${esc(r.label)}</td>
              <td align="right" style="padding:6px 8px;border-bottom:1px solid #f1f3f2;color:#374151;">${r.count}</td>
              <td align="right" style="padding:6px 8px;border-bottom:1px solid #f1f3f2;color:#374151;">${
                r.each != null ? `&minus;${esc(r.count * r.each)}` : "&mdash;"
              }</td>
            </tr>`
          )
          .join("")}
      </table>`
    : "";

  // ── The findings themselves, with QA's markup ─────────────────────────────
  const issuesHtml = input.issues
    .map((issue) => {
      const style = SEVERITY_STYLE[String(issue.severity).toUpperCase()] ?? SEVERITY_STYLE.MINOR;
      return `<tr><td style="padding:0 0 14px;">
        <table style="width:100%;border:1px solid #e5e7eb;border-radius:10px;border-collapse:separate;">
          <tr><td style="padding:12px 14px;">
            <span style="display:inline-block;padding:2px 9px;border-radius:9999px;background:${style.bg};color:${style.ink};font-size:11px;font-weight:700;">${esc(style.label)}</span>
            <strong style="margin-left:8px;color:#111827;font-size:13px;">${esc(issue.categoryLabel)}</strong>
            ${
              issue.guestReadyImpact
                ? `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:9999px;background:#fef3c7;color:#92400e;font-size:10.5px;font-weight:700;">Guest-ready impact</span>`
                : ""
            }
            <p style="margin:8px 0 0;color:#4b5563;font-size:13px;line-height:1.5;">${esc(issue.description)}</p>
            ${
              issue.photoUrl
                ? `<img src="${esc(issue.photoUrl)}" alt="What the inspector marked" style="margin-top:10px;max-width:260px;width:100%;border-radius:8px;border:1px solid #e5e7eb;" />`
                : ""
            }
          </td></tr>
        </table>
      </td></tr>`;
    })
    .join("");

  const focus = buildImprovementFocus(input.issues);
  const focusHtml = focus.length
    ? `<div style="margin:18px 0 0;padding:14px 16px;background:#f7f9f8;border:1px solid #e4e9e6;border-radius:10px;">
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#7c8b85;">What to focus on next</p>
        <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.6;">
          ${focus.map((f) => `<li>${esc(f)}</li>`).join("")}
        </ul>
        ${
          input.coachingNote
            ? `<p style="margin:10px 0 0;color:#4b5563;font-size:13px;line-height:1.5;white-space:pre-wrap;">${esc(input.coachingNote)}</p>`
            : ""
        }
      </div>`
    : input.coachingNote
      ? `<div style="margin:18px 0 0;padding:14px 16px;background:#f7f9f8;border:1px solid #e4e9e6;border-radius:10px;">
          <p style="margin:0;color:#4b5563;font-size:13px;line-height:1.5;white-space:pre-wrap;">${esc(input.coachingNote)}</p>
        </div>`
      : "";

  const headline = input.passed ? "Your clean passed inspection" : "Your clean needs attention";

  const html = `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#10221c;max-width:620px;">
    <div style="background:#10221c;color:#fff;border-radius:14px;padding:22px 24px;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#a8874e;">Quality assurance</p>
      <h1 style="margin:0;font-size:20px;font-weight:600;">${esc(headline)}</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#c9d4cf;">
        ${esc(input.propertyName ?? "Your job")}${input.jobDateLabel ? ` &middot; ${esc(input.jobDateLabel)}` : ""}${input.jobNumber ? ` &middot; Job ${esc(input.jobNumber)}` : ""}
      </p>
    </div>

    <p style="margin:18px 0 0;font-size:15px;color:#111827;">
      Score <strong>${score}%</strong>${ratingLabel ? ` &middot; ${esc(ratingLabel)}` : ""}
    </p>
    ${
      input.managementReview
        ? `<p style="margin:8px 0 0;font-size:13px;color:#b45309;">A critical finding means this inspection goes to management review.</p>`
        : ""
    }
    ${breakdownHtml}

    ${
      issuesHtml
        ? `<h2 style="margin:22px 0 10px;font-size:14px;color:#10221c;border-bottom:1px solid #e4e9e6;padding-bottom:6px;">What was found</h2>
           <table style="width:100%;border-collapse:collapse;">${issuesHtml}</table>`
        : `<p style="margin:18px 0 0;font-size:13px;color:#4b5563;">No specific issues were recorded against this clean.</p>`
    }

    ${focusHtml}

    <p style="margin:22px 0 0;">
      <a href="${esc(input.qualityUrl)}" style="display:inline-block;background:#10221c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:13px;">See the full feedback</a>
      ${
        input.reportUrl
          ? `<a href="${esc(input.reportUrl)}" style="display:inline-block;margin-left:8px;color:#10221c;text-decoration:underline;font-size:13px;">Download the report</a>`
          : ""
      }
    </p>
  </div>`;

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
            (i) => `- [${String(i.severity).toUpperCase()}] ${i.categoryLabel}: ${i.description}`
          ),
        ]
      : ["No specific issues were recorded against this clean."]),
    ...(focus.length ? ["", `What to focus on next: ${focus.join(", ")}`] : []),
    ...(input.coachingNote ? ["", input.coachingNote] : []),
    "",
    `See the full feedback: ${input.qualityUrl}`,
  ];

  return { subject, html, text: textLines.join("\n") };
}
