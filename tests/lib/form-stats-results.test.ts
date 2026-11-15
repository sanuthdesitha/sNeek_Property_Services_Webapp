// @vitest-environment node
/**
 * Forms › Results and stats (board 2026-11-17): unknown is never zero, the
 * question sort, and "QA issues after" (same job and area, after the
 * submission; issues that cannot be placed are counted as not placed).
 */
import { describe, expect, it } from "vitest";
import { buildQuestionRows, formatCompletion, sortQuestionRows, statsHref, type QuestionStatInput } from "@/components/v2/admin/forms/library/form-stats-rows";
import { areaOfIssue, buildFormAreaMap, tallyQaIssuesAfter, type QaIssueForArea } from "@/lib/forms/qa-issues-after";
import { buildWeekBuckets } from "@/lib/forms/form-stats-data";

const base: QuestionStatInput = {
  id: "q",
  label: "Photo of oven interior",
  type: "photo",
  sectionLabel: "Kitchen",
  locationTag: "Kitchen",
  conditionNote: null,
  rotational: false,
  answered: 0,
  shown: 0,
  skipped: 0,
  photoTotal: 0,
  yesCount: 0,
  noCount: 0,
  ratingSum: 0,
  ratingCount: 0,
  details: [],
};

describe("question rows", () => {
  it('says "No submissions yet" instead of "0 photos average" and never shows unknown as 0', () => {
    const [row] = buildQuestionRows({ questions: [base], parsed: 0, weeks: 8, qaAfter: { status: "ready", byArea: new Map() } });
    expect(row.result).toBe("No submissions yet");
    expect(row.answeredText).toBe("–");
    expect(row.skippedText).toBe("–");
    expect(row.qaText).toBe("–");
  });

  it("writes None only for a real zero and – when skipping cannot be told", () => {
    const rows = buildQuestionRows({
      questions: [
        { ...base, id: "a", answered: 10, shown: 10, skipped: 0, photoTotal: 12 },
        { ...base, id: "b", rotational: true, shown: null, skipped: null, answered: 3, photoTotal: 3 },
      ],
      parsed: 10,
      weeks: 8,
      qaAfter: { status: "ready", byArea: new Map() },
    });
    expect(rows[0].skippedText).toBe("None");
    expect(rows[0].result).toBe("1.2 photos average");
    expect(rows[0].qaText).toBe("None");
    expect(rows[1].skippedText).toBe("–");
    expect(rows[1].sub).toContain("on some cleans");
  });

  it('shows "No" with its reasons and the QA note, tints skipped-and-followed-by-issues, and says when QA could not be read', () => {
    const yesNo = { ...base, id: "oven", type: "yesno", answered: 100, shown: 100, skipped: 20, yesCount: 93, noCount: 7, details: ["Out of degreaser", "Out of degreaser", "Guest left food"] };
    const [row] = buildQuestionRows({
      questions: [yesNo],
      parsed: 100,
      weeks: 8,
      qaAfter: { status: "ready", byArea: new Map([["Kitchen", { count: 11, confirmedFalse: 3, topCategory: "Kitchen detail", topCleaner: { name: "Marco R.", count: 6 } }]]) },
    });
    expect(row.result).toBe("7% No");
    expect(row.resultDetail).toBe('"Out of degreaser" (×2) · "Guest left food"');
    expect(row.qaText).toBe("11");
    expect(row.qaNote).toBe("Kitchen detail, 6 by Marco R. · 3 confirmed false confirmations");
    expect(row.flagged).toBe(true);
    const [failed] = buildQuestionRows({ questions: [yesNo], parsed: 100, weeks: 8, qaAfter: { status: "failed" } });
    expect(failed.qaText).toBe("–");
    expect(failed.qaNote).toBe("Could not be read");
    const [untagged] = buildQuestionRows({ questions: [{ ...yesNo, locationTag: undefined }], parsed: 100, weeks: 8, qaAfter: { status: "ready", byArea: new Map() } });
    expect(untagged.qaNote).toBe("No area tag");
  });

  it("sorts most skipped / No / issues with unknown last and keeps form order on ties", () => {
    const rows = buildQuestionRows({
      questions: [
        { ...base, id: "a", answered: 5, shown: 10, skipped: 5 },
        { ...base, id: "b", rotational: true, shown: null, skipped: null, answered: 1 },
        { ...base, id: "c", answered: 1, shown: 10, skipped: 9 },
      ],
      parsed: 10,
      weeks: 8,
      qaAfter: { status: "ready", byArea: new Map() },
    });
    expect(sortQuestionRows(rows, "skipped").map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(sortQuestionRows(rows, "order").map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("formats completion as clock-on to submit and keeps the stats URL", () => {
    expect(formatCompletion(161)).toBe("2 h 41");
    expect(formatCompletion(38)).toBe("38 min");
    expect(formatCompletion(null)).toBe("Not tracked");
    expect(statsHref({ templateId: "t1", weeks: 12, qsort: "no" })).toBe("/v2/admin/forms?tab=stats&templateId=t1&weeks=12&qsort=no");
  });
});

describe("QA issues after (same job and area, not proof of cause)", () => {
  const map = buildFormAreaMap([
    { title: "Kitchen", fields: [{ id: "oven", locationTag: "Kitchen" }, { id: "bench", locationTag: "Kitchen" }] },
    { title: "Bathroom", fields: [{ id: "shower", locationTag: "Bathroom" }] },
    { title: "Mixed", fields: [{ id: "a", locationTag: "Kitchen" }, { id: "b", locationTag: "Outdoor" }] },
  ]);
  const issue = (over: Partial<QaIssueForArea>): QaIssueForArea => ({
    id: "i", jobId: "j1", createdAt: new Date("2026-11-10T05:00:00Z"), category: "kitchen_detail", cleanerName: "Marco R.", falseConfirmation: "NONE", cleanerMediaFieldIds: [], qaSectionTitle: null, ...over,
  });

  it("places an issue by its cleaner photos first, then by the matched QA section, otherwise not at all", () => {
    expect(areaOfIssue(issue({ cleanerMediaFieldIds: ["oven"] }), map)).toBe("Kitchen");
    expect(areaOfIssue(issue({ cleanerMediaFieldIds: ["oven", "shower"] }), map)).toBeNull();
    expect(areaOfIssue(issue({ qaSectionTitle: "Bathroom — QA Inspection" }), map)).toBe("Bathroom");
    expect(areaOfIssue(issue({ qaSectionTitle: "Mixed" }), map)).toBeNull();
    expect(areaOfIssue(issue({}), map)).toBeNull();
  });

  it("counts only issues after the job's first submission and reports the ones it could not place", () => {
    const submissions = [{ jobId: "j1", createdAt: new Date("2026-11-10T04:00:00Z") }];
    const result = tallyQaIssuesAfter(
      submissions,
      [
        issue({ id: "1", cleanerMediaFieldIds: ["oven"], falseConfirmation: "CONFIRMED" }),
        issue({ id: "2", createdAt: new Date("2026-11-10T03:00:00Z"), cleanerMediaFieldIds: ["oven"] }),
        issue({ id: "3", jobId: "other", cleanerMediaFieldIds: ["oven"] }),
        issue({ id: "4" }),
      ],
      map,
    );
    expect(result.considered).toBe(2);
    expect(result.notPlaced).toBe(1);
    expect(result.byArea.get("Kitchen")).toMatchObject({ count: 1, confirmedFalse: 1 });
  });
});

describe("weekly buckets", () => {
  it("are Monday weeks in the organisation timezone with only the current week partial", () => {
    const buckets = buildWeekBuckets(new Date("2026-11-15T03:00:00Z"), 4, "Australia/Sydney");
    expect(buckets.map((bucket) => bucket.weekStart)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(buckets.map((bucket) => bucket.partial)).toEqual([false, false, false, true]);
  });
});
