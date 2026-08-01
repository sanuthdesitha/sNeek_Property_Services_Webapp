import { describe, expect, it } from "vitest";
import {
  buildImprovementFocus,
  buildQaResultEmail,
  type QaResultEmailIssue,
} from "@/lib/notifications/qa-result-email";

/**
 * The defect these guard: the old email said "This clean did not pass
 * inspection." plus a bare count, and named not one actual issue. A cleaner
 * learned they had failed and nothing about what to fix. Everything needed was
 * already computed at submit time and discarded.
 */

const ISSUES: QaResultEmailIssue[] = [
  {
    severity: "MAJOR",
    categoryLabel: "Bed setup & linen",
    description: "Top sheet untucked on the queen bed.",
    guestReadyImpact: true,
    photoUrl: "https://signed.example/flat1.jpg",
  },
  {
    severity: "MINOR",
    categoryLabel: "Bed setup & linen",
    description: "Pillow shams uneven.",
  },
  {
    severity: "MINOR",
    categoryLabel: "Kitchen reset",
    description: "Coffee machine filter not emptied.",
  },
];

function build(over: Partial<Parameters<typeof buildQaResultEmail>[0]> = {}) {
  return buildQaResultEmail({
    companyName: "sNeek",
    propertyName: "Jackson Property-11",
    jobNumber: "J-100",
    jobDateLabel: "20 Jul 2026",
    score: 84,
    rating: "NEEDS_IMPROVEMENT",
    passed: false,
    issues: ISSUES,
    deductions: { minor: 3, major: 10, critical: 25 },
    qualityUrl: "https://app.example/v2/cleaner/quality",
    ...over,
  });
}

describe("buildQaResultEmail — names what actually went wrong", () => {
  it("includes every issue's description, not just a count", () => {
    const { html, text } = build();
    for (const issue of ISSUES) {
      expect(html).toContain(issue.description);
      expect(text).toContain(issue.description);
    }
  });

  it("uses the admin-configured category label", () => {
    const { html } = build();
    expect(html).toContain("Bed setup &amp; linen");
    expect(html).toContain("Kitchen reset");
  });

  it("shows QA's flattened markup photo when there is one", () => {
    const { html } = build();
    expect(html).toContain("https://signed.example/flat1.jpg");
  });

  it("flags guest-ready impact", () => {
    expect(build().html).toContain("Guest-ready impact");
  });

  it("shows the score arithmetic using SETTINGS values, not hardcoded ones", () => {
    // 1 major × 10, 2 minor × 3 → the email must reflect configured deductions.
    const { html } = build();
    expect(html).toContain("&minus;10");
    expect(html).toContain("&minus;6");

    // Retune the settings and the email must follow.
    const retuned = build({ deductions: { minor: 1, major: 4, critical: 9 } });
    expect(retuned.html).toContain("&minus;4");
    expect(retuned.html).toContain("&minus;2");
    expect(retuned.html).not.toContain("&minus;10");
  });

  it("omits the effect column value when deductions are unknown", () => {
    const { html } = build({ deductions: null });
    expect(html).toContain("&mdash;");
  });

  it("links to the quality hub, not a dead v1 job path", () => {
    const { html, text } = build();
    expect(html).toContain("https://app.example/v2/cleaner/quality");
    expect(text).toContain("https://app.example/v2/cleaner/quality");
    expect(html).not.toContain("/cleaner/jobs/");
  });

  it("distinguishes pass from fail in the subject", () => {
    expect(build({ passed: false }).subject).toContain("needs attention");
    expect(build({ passed: true, score: 98, rating: "EXCELLENT" }).subject).toContain("passed");
  });

  it("calls out management review when a critical triggered it", () => {
    expect(build({ managementReview: true }).html).toContain("management review");
    expect(build({ managementReview: false }).html).not.toContain("management review");
  });

  it("still reads sensibly when there are no issues at all", () => {
    const { html, text } = build({ issues: [], passed: true, score: 100 });
    expect(html).toContain("No specific issues were recorded");
    expect(text).toContain("No specific issues were recorded");
  });

  it("escapes user-supplied text rather than injecting markup", () => {
    const { html } = build({
      issues: [
        {
          severity: "MINOR",
          categoryLabel: "Other",
          description: `<script>alert("x")</script>`,
        },
      ],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the plain-text fallback substantive", () => {
    // Some cleaners read mail in clients that strip HTML; "you failed" with no
    // detail is exactly the defect being fixed.
    const { text } = build();
    expect(text).toContain("What was found:");
    expect(text).toContain("[MAJOR] Bed setup & linen");
  });
});

describe("buildImprovementFocus", () => {
  it("ranks the categories that actually recurred in this inspection", () => {
    expect(buildImprovementFocus(ISSUES)).toEqual([
      "Bed setup & linen (2 findings)",
      "Kitchen reset",
    ]);
  });

  it("caps at three so the advice stays actionable", () => {
    const many = ["A", "B", "C", "D", "E"].map((c) => ({
      severity: "MINOR",
      categoryLabel: c,
      description: "x",
    }));
    expect(buildImprovementFocus(many)).toHaveLength(3);
  });

  it("returns nothing when there is nothing to improve", () => {
    expect(buildImprovementFocus([])).toEqual([]);
  });
});
