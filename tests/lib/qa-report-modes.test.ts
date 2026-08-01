import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The cleaner-safe QA report must not leak internal commercial detail.
 *
 * The report is one builder serving two audiences, so the risk is a future edit
 * quietly widening what a cleaner receives. These tests render both modes from
 * the same fixture and assert on the actual HTML: the internal report shows
 * damage cost estimates, rework pay movement and the inspector's private notes;
 * the cleaner's copy shows none of them, while still explaining the score.
 *
 * They also pin the three defects that made the old report useless: no images,
 * relative (unfetchable) image URLs, and a signature flattened onto black.
 */

const SIGNATURE_KEY = "qa-signatures/sig.png";

const jobFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({ db: { job: { findUnique: (...a: any[]) => jobFindUnique(...a) } } }));

vi.mock("@/lib/s3", () => ({
  // Presigned URLs are absolute + query-signed; the old publicUrl path returned
  // a bare/relative path that resolved to nothing in the PDF renderer.
  getPresignedDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}?sig=abc`),
  publicUrl: (key: string) => `/${key}`,
  s3: {
    getObject: () => ({
      promise: async () => ({ Body: Buffer.from("PNGDATA"), ContentType: "image/png" }),
    }),
  },
}));

vi.mock("@/lib/settings", () => ({
  getAppSettings: vi.fn(async () => ({
    companyName: "sNeek",
    logoUrl: "",
    reportLogoUrl: "",
    accountability: {
      scoring: { minorDeduction: 3, majorDeduction: 10, criticalDeduction: 25 },
      issueCategories: [{ key: "bed_setup", label: "Bed setup & linen" }],
    },
  })),
}));

const PRIVATE_NOTE = "Cleaner has been slipping for weeks, watch them.";
const DAMAGE_COST = 249.5;

function fixture() {
  return {
    id: "job1",
    jobNumber: "J-100",
    scheduledDate: new Date("2026-07-20T00:00:00Z"),
    gpsCheckInAt: new Date("2026-07-20T23:05:00Z"),
    gpsDistanceMeters: 18,
    property: { name: "Jackson Property-11", address: "1 Rose St", suburb: "Bondi", client: {} },
    assignments: [{ user: { name: "Cleaner One", email: "c1@x.com" } }],
    qaReviews: [
      {
        id: "rev1",
        score: 87,
        rawScore: 87,
        passed: false,
        rating: "NEEDS_IMPROVEMENT",
        managementReview: false,
        adjustmentReason: null,
        notes: PRIVATE_NOTE,
        reviewedBy: { name: "Inspector Ann", email: "qa@x.com" },
      },
    ],
    qaIssues: [
      {
        id: "iss1",
        severity: "MAJOR",
        category: "bed_setup",
        description: "Top sheet untucked on the queen bed.",
        guestReadyImpact: true,
        cleanerMarkedComplete: true,
        falseConfirmation: "SUSPECTED",
        qaPhotoKeys: [{ key: "orig.jpg", annotatedKey: "ov.png", flatKey: "flat.jpg" }],
        cleaner: { name: "Cleaner One" },
      },
    ],
    formSubmissions: [{ media: [{ s3Key: "cleaner-photo.jpg", kind: "IMAGE" }] }],
    qaFormSubmissions: [
      {
        score: 87,
        passed: false,
        notes: "",
        categoryScores: {},
        template: { schema: { sections: [] } },
        submittedBy: { name: "Inspector Ann" },
        assignment: {
          assignedTo: { name: "Inspector Ann" },
          pickedUpBy: null,
          onSiteMinutes: 24,
          checkInAt: new Date("2026-07-21T00:10:00Z"),
          checkInSkippedReason: null,
        },
        data: {
          __qaTools: {
            sectionPhotos: {},
            mediaAnnotations: {},
            damage: [
              {
                area: "Bathroom mirror",
                description: "Chipped corner",
                severity: "MEDIUM",
                photoKeys: [],
                estimatedCost: DAMAGE_COST,
              },
            ],
            rework: {
              enabled: true,
              severity: "MINOR",
              reason: "Redo the bedroom",
              areas: ["Bedroom"],
              flaggedAreas: [],
              minutesFromCleaner: 45,
              amountFromCleaner: 30,
            },
            onSite: { minutes: 24 },
            signOff: {
              signatureKey: SIGNATURE_KEY,
              attested: true,
              signedByName: "Inspector Ann",
              signedAt: null,
            },
          },
        },
      },
    ],
  };
}

async function build(mode: "internal" | "cleanerSafe") {
  const { buildQaReportHtml } = await import("@/lib/reports/qa-report");
  const out = await buildQaReportHtml("job1", { mode });
  if (!out) throw new Error("expected a report");
  return out.html;
}

describe("QA report — cleaner-safe redaction", () => {
  beforeEach(() => {
    jobFindUnique.mockReset();
    jobFindUnique.mockResolvedValue(fixture());
  });

  it("the internal report carries damage cost, rework pay and private notes", async () => {
    const html = await build("internal");
    expect(html).toContain("249.50");
    expect(html).toContain("45 min");
    expect(html).toContain(PRIVATE_NOTE);
    expect(html).toContain("False confirmation");
  });

  it("the cleaner's copy carries NONE of those", async () => {
    const html = await build("cleanerSafe");
    expect(html).not.toContain("249.50");
    expect(html).not.toContain(PRIVATE_NOTE);
    expect(html).not.toContain("False confirmation");
    // Rework pay movement between staff is internal; the fact of the rework is not.
    expect(html).not.toContain("Amount: $");
    expect(html).toContain("Redo the bedroom");
  });

  it("still explains the score to the cleaner", async () => {
    const html = await build("cleanerSafe");
    expect(html).toContain("How this score was reached");
    expect(html).toContain("Major issues");
    // Deduction figures come from settings, never hardcoded.
    expect(html).toContain("−10");
    expect(html).toContain("Top sheet untucked on the queen bed.");
    // The admin-configured label, not the raw key.
    expect(html).toContain("Bed setup &amp; linen");
  });
});

describe("QA report — the three defects that emptied it", () => {
  beforeEach(() => {
    jobFindUnique.mockReset();
    jobFindUnique.mockResolvedValue(fixture());
  });

  it("renders per-item issue photos (the source that was never queried)", async () => {
    const html = await build("internal");
    // The FLATTENED key, never the bare transparent overlay.
    expect(html).toContain("https://signed.example/flat.jpg");
    expect(html).not.toContain("ov.png");
  });

  it("renders the cleaner's own submitted evidence", async () => {
    const html = await build("internal");
    expect(html).toContain("https://signed.example/cleaner-photo.jpg");
    expect(html).toContain("Cleaner's submitted evidence");
  });

  it("presigns image URLs instead of emitting relative paths", async () => {
    const html = await build("internal");
    // A relative src resolves to nothing on about:blank, which is why the PDF
    // had no pictures at all.
    expect(html).not.toMatch(/src="\/[a-z]/);
    expect(html).toContain("https://signed.example/");
  });

  it("inlines the signature as a data URL so the PDF cannot flatten it onto black", async () => {
    const html = await build("internal");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain(SIGNATURE_KEY);
  });

  it("stamps the template version for cache-busting", async () => {
    const html = await build("internal");
    expect(html).toContain("report-template:qa-v2-estate");
  });
});
