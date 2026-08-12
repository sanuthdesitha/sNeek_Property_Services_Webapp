import { describe, it, expect } from "vitest";
import { buildReportViewModel } from "@/lib/reports/report-view-model";
import { renderEstateReport, type EstateRenderCtx } from "@/lib/reports/estate-template";

const SYD_NOON_UTC = "2026-07-12T02:00:00.000Z"; // 12:00 pm Sydney (AEST)

function makeJob(overrides: Record<string, any> = {}) {
  return {
    id: "job1",
    jobNumber: "J-1001",
    jobType: "AIRBNB_TURNOVER",
    scheduledDate: new Date(SYD_NOON_UTC),
    gpsCheckInAt: new Date("2026-07-11T23:05:00.000Z"), // 9:05 am Sydney
    gpsCheckOutAt: new Date("2026-07-12T01:35:00.000Z"), // 11:35 am Sydney
    actualHours: 2.5,
    isRework: false,
    property: {
      name: "Harbour View Apartment",
      address: "1 Wharf Rd",
      suburb: "Sydney",
      hasBalcony: false,
    },
    assignments: [{ user: { name: "Alice" } }, { user: { name: "Bob" } }],
    ...overrides,
  };
}

function makeSubmission(overrides: Record<string, any> = {}) {
  const schema = {
    sections: [
      {
        id: "kitchen",
        label: "Kitchen",
        fields: [
          { id: "bench_wiped", label: "Bench wiped", type: "checkbox" },
          { id: "oven_clean", label: "Oven cleaned", type: "yesno" },
          { id: "oven_note", label: "Oven note", type: "longtext", conditional: { fieldId: "oven_clean", operator: "equals", value: false } },
          { id: "shine_rating", label: "Shine rating", type: "rating", max: 5 },
          { id: "kitchen_photos", label: "Kitchen photos", type: "photo" },
          { id: "info1", label: "Info", type: "instruction", description: "Wipe all surfaces" },
          { id: "optional_text", label: "Anything else?", type: "text" },
        ],
      },
      {
        id: "balcony",
        label: "Balcony",
        fields: [{ id: "balcony_swept", label: "Balcony swept", type: "checkbox" }],
      },
      {
        id: "signoff",
        label: "Sign off",
        fields: [
          {
            id: "guest_ready",
            label: "Guest ready",
            type: "yesno",
            children: [
              { id: "guest_ready_why", label: "Why not?", type: "text", conditional: { fieldId: "guest_ready", operator: "equals", value: false } },
            ],
          },
          { id: "sig", label: "Cleaner signature", type: "signature" },
        ],
      },
    ],
  };
  return {
    id: "sub1",
    createdAt: new Date(SYD_NOON_UTC),
    submittedBy: { name: "Alice" },
    laundryReady: true,
    bagLocation: "Front hallway",
    data: {
      __templateSchema: schema,
      bench_wiped: true,
      oven_clean: false,
      oven_note: "Grease behind the racks",
      shine_rating: 4,
      guest_ready: true,
      sig: "data:image/png;base64,abc123",
      __adminRequestedTasks: [
        { title: "Replace batteries", completed: true, requiresPhoto: true, photoFieldId: "task_photo_1" },
      ],
      __jobTasks: [
        { title: "Fix towel rail", decision: "NOT_COMPLETED", note: "No tools on site", proofFieldId: "task_proof_1", source: "CLIENT_REQUEST" },
      ],
    },
    media: [
      { id: "m1", fieldId: "kitchen_photos", mediaType: "IMAGE", url: "https://cdn/x1.jpg", createdAt: new Date(SYD_NOON_UTC), label: "kitchen photos" },
      { id: "m2", fieldId: "kitchen_photos", mediaType: "VIDEO", url: "https://cdn/x2.mp4", createdAt: new Date(SYD_NOON_UTC) },
      { id: "m3", fieldId: "task_photo_1", mediaType: "IMAGE", url: "https://cdn/t1.jpg", createdAt: new Date(SYD_NOON_UTC) },
      { id: "m4", fieldId: "task_proof_1", mediaType: "IMAGE", url: "https://cdn/t2.jpg", createdAt: new Date(SYD_NOON_UTC) },
      { id: "m5", fieldId: "extra_shot", mediaType: "IMAGE", url: "https://cdn/extra.jpg", createdAt: new Date(SYD_NOON_UTC) },
    ],
    stockTxs: [
      { quantity: -2, propertyStock: { item: { name: "Toilet paper" } } },
      { quantity: 5, propertyStock: { item: { name: "Ignore restock-in" } } },
    ],
    ...overrides,
  };
}

function build(jobOverrides = {}, subOverrides = {}, extra: Record<string, any> = {}) {
  return buildReportViewModel({
    job: makeJob(jobOverrides),
    submission: makeSubmission(subOverrides),
    localDate: "12 July 2026",
    ...extra,
  });
}

describe("buildReportViewModel", () => {
  it("mirrors visible sections in form order and hides balcony sections when the property has none", () => {
    const vm = build();
    expect(vm.sections.map((s) => s.label)).toEqual(["Kitchen", "Sign off"]);
  });

  it("includes balcony sections when property.hasBalcony is true", () => {
    const vm = build({ property: { name: "P", address: "A", suburb: "S", hasBalcony: true } });
    expect(vm.sections.map((s) => s.label)).toContain("Balcony");
  });

  it("maps every field type: checkbox, yesno, conditional longtext, rating, photo, instruction, signature", () => {
    const vm = build();
    const kitchen = vm.sections[0];
    const byId = Object.fromEntries(kitchen.fields.map((f) => [f.id, f]));

    expect(byId.bench_wiped.kind).toBe("checkbox");
    expect(byId.bench_wiped.checked).toBe(true);

    expect(byId.oven_clean.kind).toBe("yesno");
    expect(byId.oven_clean.yesNo).toBe("no");

    // Conditional reveal: oven_note visible because oven_clean === false.
    expect(byId.oven_note.kind).toBe("longtext");
    expect(byId.oven_note.value).toBe("Grease behind the racks");

    expect(byId.shine_rating.kind).toBe("rating");
    expect(byId.shine_rating.rating).toEqual({ value: 4, max: 5 });

    expect(byId.kitchen_photos.kind).toBe("media");
    expect(byId.kitchen_photos.answered).toBe(true);

    expect(byId.info1.kind).toBe("instruction");
    expect(byId.info1.value).toBe("Wipe all surfaces");

    const signoff = vm.sections[1];
    const sig = signoff.fields.find((f) => f.id === "sig")!;
    expect(sig.kind).toBe("signature");
    expect(sig.signatureDataUrl).toBe("data:image/png;base64,abc123");
  });

  it("renders unanswered visible fields as an em dash instead of dropping them", () => {
    const vm = build();
    const optional = vm.sections[0].fields.find((f) => f.id === "optional_text")!;
    expect(optional.answered).toBe(false);
    expect(optional.value).toBe("—");
  });

  it("hides conditional children whose parent condition is not met", () => {
    const vm = build();
    const signoff = vm.sections.find((s) => s.label === "Sign off")!;
    // guest_ready === true, so the "Why not?" child (condition: false) is hidden.
    expect(signoff.fields.find((f) => f.id === "guest_ready_why")).toBeUndefined();
  });

  it("attaches media to the right fields with Sydney timestamps and tracks leftovers as extra media", () => {
    const vm = build();
    const photos = vm.sections[0].fields.find((f) => f.id === "kitchen_photos")!;
    expect(photos.media).toHaveLength(2);
    expect(photos.media[0].url).toBe("https://cdn/x1.jpg");
    expect(photos.media[0].timestamp).toContain("12 Jul 2026");
    expect(photos.media[1].isVideo).toBe(true);

    expect(vm.extraMedia).toHaveLength(1);
    expect(vm.extraMedia[0].url).toBe("https://cdn/extra.jpg");
  });

  it("maps admin and unified job tasks with proof media and status tones", () => {
    const vm = build();
    expect(vm.adminTasks).toHaveLength(1);
    expect(vm.adminTasks[0].statusTone).toBe("good");
    expect(vm.adminTasks[0].media[0].url).toBe("https://cdn/t1.jpg");

    expect(vm.jobTasks).toHaveLength(1);
    expect(vm.jobTasks[0].statusTone).toBe("bad");
    expect(vm.jobTasks[0].noteLabel).toBe("Reason");
    expect(vm.jobTasks[0].media[0].url).toBe("https://cdn/t2.jpg");
  });

  it("summarises laundry, stock usage and timing stats", () => {
    const vm = build();
    expect(vm.laundry?.readyLabel).toBe("Yes");
    expect(vm.laundry?.bagLocation).toBe("Front hallway");
    expect(vm.stockUsed).toEqual([{ name: "Toilet paper", quantity: 2 }]);

    const timing = vm.stats.find((s) => s.label === "Timing")!;
    expect(timing.value).toBe("9:05 am – 11:35 am");
    expect(timing.sub).toBe("2.5 h");
  });

  it("renders a sanctioned no-photo reason as an explicit answer on media fields", () => {
    const vm = build({}, {
      data: {
        __templateSchema: {
          sections: [
            {
              id: "k",
              label: "Kitchen",
              fields: [{ id: "kitchen_photos", label: "Kitchen photos", type: "photo" }],
            },
          ],
        },
        __noPhotoReasons: {
          kitchen_photos: { reasonCode: "AREA_INACCESSIBLE" },
        },
      },
      media: [],
      stockTxs: [],
    });
    const field = vm.sections[0].fields.find((f) => f.id === "kitchen_photos")!;
    expect(field.noPhoto).toBe(true);
    expect(field.answered).toBe(true);
    expect(field.value).toBe("No photo — Area locked or inaccessible");
  });

  it("prefers the authoritative LaundryTask over stale form answers", () => {
    // Cleaner sent an explicit "ready" update mid-job; the form (submitted
    // hours later) still says not ready. The task must win.
    const vm = build(
      {
        laundryTask: {
          status: "CONFIRMED",
          skipReasonCode: null,
          skipReasonNote: null,
          confirmations: [{ laundryReady: true, bagLocation: "Garage cupboard" }],
        },
      },
      { laundryReady: false, laundryOutcome: "NOT_READY", bagLocation: null }
    );
    expect(vm.laundry?.readyLabel).toBe("Yes");
    expect(vm.laundry?.outcome).toBe("READY FOR PICKUP");
    expect(vm.laundry?.bagLocation).toBe("Garage cupboard");
    expect(vm.flags.some((f) => f.label === "Laundry ready")).toBe(true);
  });

  it("maps skipped-pickup tasks with their reason", () => {
    const vm = build({
      laundryTask: {
        status: "SKIPPED_PICKUP",
        skipReasonCode: "NO_LINEN_USED",
        skipReasonNote: null,
        confirmations: [],
      },
    });
    expect(vm.laundry?.readyLabel).toBe("No");
    expect(vm.laundry?.outcome).toBe("NO PICKUP REQUIRED");
    expect(vm.laundry?.skipReason).toBe("NO LINEN USED");
  });

  it("falls back to the form's laundry answers when no task exists", () => {
    const vm = build(); // makeJob has no laundryTask
    expect(vm.laundry?.readyLabel).toBe("Yes");
    expect(vm.laundry?.bagLocation).toBe("Front hallway");
  });

  it("builds a client-safe QA summary (score, notes, damage, photos — no costs) and honours includeQa: false", () => {
    const qaSubmission = {
      data: {
        __qaTools: {
          damage: [{ area: "Bathroom", severity: "HIGH", description: "Cracked tile", estimatedCost: 250 }],
          sectionPhotos: { bathroom: ["qa/one.jpg"] },
        },
      },
    };
    const vm = build({}, {}, {
      qa: { score: 92, passed: true, notes: "Great clean" },
      qaSubmission,
      resolveKeyUrl: (k: string) => `https://cdn/${k}`,
    });
    expect(vm.qa?.score).toBe(92);
    expect(vm.qa?.passed).toBe(true);
    expect(vm.qa?.damage).toEqual([
      { area: "Bathroom", severity: "HIGH", description: "Cracked tile" },
    ]);
    expect(vm.qa?.photoUrls).toEqual(["https://cdn/qa/one.jpg"]);
    expect(vm.flags.some((f) => f.label === "Damage reported")).toBe(true);

    const withoutQa = build({}, {}, { qa: { score: 92, passed: true }, includeQa: false });
    expect(withoutQa.qa).toBeNull();
  });

  it("maps rework jobs: reason + flagged areas with resolved photo urls", () => {
    const vm = build(
      {
        isRework: true,
        reworkReason: "QA failed the bathroom",
        reworkAreas: [{ id: "a1", label: "Bathroom", note: "Redo shower glass", photoKeys: ["rw/1.jpg"] }],
      },
      {},
      { resolveKeyUrl: (k: string) => `https://cdn/${k}` }
    );
    expect(vm.isRework).toBe(true);
    expect(vm.reworkReason).toBe("QA failed the bathroom");
    expect(vm.reworkAreas).toEqual([
      { label: "Bathroom", note: "Redo shower glass", photoUrls: ["https://cdn/rw/1.jpg"] },
    ]);
    expect(vm.flags.some((f) => f.label === "Rework visit")).toBe(true);
  });

  it("derives clock-in/out from TimeLogs (earliest start, latest stop, summed duration)", () => {
    const vm = build({
      timeLogs: [
        {
          startedAt: new Date("2026-07-11T23:05:00.000Z"), // 9:05 am Sydney
          stoppedAt: new Date("2026-07-12T00:05:00.000Z"), // 10:05 am
          durationM: 60,
        },
        {
          startedAt: new Date("2026-07-12T00:35:00.000Z"), // 10:35 am
          stoppedAt: new Date("2026-07-12T01:35:00.000Z"), // 11:35 am
          durationM: 60,
        },
      ],
    });
    expect(vm.clockInLabel).toBe("12 Jul 2026, 9:05 am");
    expect(vm.clockOutLabel).toBe("12 Jul 2026, 11:35 am");
    expect(vm.clockOutMissing).toBe(false);
    expect(vm.clockDurationLabel).toBe("2h");

    const timing = vm.stats.find((s) => s.label === "Timing")!;
    expect(timing.value).toBe("9:05 am – 11:35 am");
    expect(timing.sub).toBe("2h");
  });

  it("reports a missing clock-out honestly and never substitutes the submission time", () => {
    const vm = build({
      timeLogs: [
        { startedAt: new Date("2026-07-11T23:05:00.000Z"), stoppedAt: null, durationM: null },
      ],
    });
    expect(vm.clockInLabel).toBe("12 Jul 2026, 9:05 am");
    expect(vm.clockOutLabel).toBeNull();
    expect(vm.clockOutMissing).toBe(true);
    expect(vm.clockDurationLabel).toBeNull();
    // Submission time stays on its own labelled field, not as a clock-out.
    expect(vm.submittedAtLabel).toBe("12 Jul 2026, 12:00 pm");

    const timing = vm.stats.find((s) => s.label === "Timing")!;
    expect(timing.value).toBe("9:05 am");
    expect(timing.sub).toBe("clock-out not recorded");
  });

  it("treats a job with an open segment among stopped ones as not clocked out", () => {
    const vm = build({
      timeLogs: [
        {
          startedAt: new Date("2026-07-11T23:05:00.000Z"),
          stoppedAt: new Date("2026-07-12T00:05:00.000Z"),
          durationM: 60,
        },
        { startedAt: new Date("2026-07-12T00:35:00.000Z"), stoppedAt: null, durationM: null },
      ],
    });
    expect(vm.clockOutLabel).toBeNull();
    expect(vm.clockOutMissing).toBe(true);
  });

  it("shows no clock data when the job has no TimeLogs at all", () => {
    const vm = build({ timeLogs: [], gpsCheckInAt: null, gpsCheckOutAt: null });
    expect(vm.clockInLabel).toBeNull();
    expect(vm.clockOutLabel).toBeNull();
    expect(vm.clockOutMissing).toBe(false);
    const timing = vm.stats.find((s) => s.label === "Timing")!;
    expect(timing.value).toBe("—");
  });

  it("maps the GPS attendance record (coords, map links, accuracy, distance, adjusted flag)", () => {
    const vm = build({
      gpsCheckInLat: -33.86881,
      gpsCheckInLng: 151.2093,
      gpsCheckInAccuracyM: 12.4,
      gpsCheckOutLat: -33.8689,
      gpsCheckOutLng: 151.2094,
      gpsDistanceMeters: 34,
      gpsCheckInAdjusted: true,
    });
    expect(vm.gps).not.toBeNull();
    expect(vm.gps?.checkIn?.coords).toBe("-33.86881, 151.20930");
    expect(vm.gps?.checkIn?.mapUrl).toBe("https://www.google.com/maps?q=-33.86881,151.2093");
    expect(vm.gps?.checkIn?.accuracyLabel).toBe("±12 m");
    expect(vm.gps?.checkIn?.timeLabel).toBe("12 Jul 2026, 9:05 am");
    expect(vm.gps?.checkOut?.coords).toBe("-33.86890, 151.20940");
    expect(vm.gps?.distanceLabel).toBe("34 m");
    expect(vm.gps?.adjusted).toBe(true);
  });

  it("omits the GPS record entirely when no coordinates were captured", () => {
    const vm = build();
    expect(vm.gps).toBeNull();
  });

  it("counts checklist completion and issues in the stat tiles", () => {
    const vm = build();
    const checklist = vm.stats.find((s) => s.label === "Checklist completed")!;
    // Kitchen: 6 answerable (instruction excluded), 5 answered (optional_text blank).
    // Sign off: 2 answerable, 2 answered.
    expect(checklist.value).toBe("7/8");

    const issues = vm.stats.find((s) => s.label === "Issues reported")!;
    expect(issues.value).toBe("1"); // the NOT_COMPLETED job task
  });
});

describe("renderEstateReport", () => {
  const ctx: EstateRenderCtx = {
    headTags: "<meta charset=\"UTF-8\"/>",
    primaryHsl: "215 45% 18%",
    accentHsl: "38 64% 50%",
    companyName: "sNeek Property Services",
    logoUrl: "",
    renderedTitle: "Harbour View Apartment — Service Report",
    photoDims: { w: 200, h: 150 },
    showHeader: true,
    showSummary: true,
    showTaskChecklist: true,
    showGallery: true,
    showQaSummary: true,
    showSupplies: true,
    showFooter: true,
    customFooter: "",
  };

  it("renders every section, field label and answer from the view model", () => {
    const html = renderEstateReport(build(), ctx);
    for (const text of [
      "Harbour View Apartment",
      "1 Wharf Rd, Sydney",
      "Kitchen",
      "Sign off",
      "Bench wiped",
      "Oven cleaned",
      "Grease behind the racks",
      "Cleaner signature",
      "data:image/png;base64,abc123",
      "https://cdn/x1.jpg",
      "Replace batteries",
      "Fix towel rail",
      "Laundry",
      "Toilet paper",
      "Additional evidence",
      "https://cdn/extra.jpg",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("escapes HTML in cleaner-entered answers", () => {
    const vm = build({}, {
      data: {
        __templateSchema: {
          sections: [{ id: "s", label: "Sec", fields: [{ id: "t", label: "Note", type: "text" }] }],
        },
        t: "<script>alert(1)</script>",
      },
      media: [],
      stockTxs: [],
    });
    const html = renderEstateReport(vm, ctx);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the clock-truth line and keeps the submission time separately labelled", () => {
    const vm = build({
      timeLogs: [
        {
          startedAt: new Date("2026-07-11T23:05:00.000Z"),
          stoppedAt: new Date("2026-07-12T01:35:00.000Z"),
          durationM: 150,
        },
      ],
    });
    const html = renderEstateReport(vm, ctx);
    expect(html).toContain("Clock-in:</strong> 12 Jul 2026, 9:05 am");
    expect(html).toContain("Clock-out:</strong> 12 Jul 2026, 11:35 am");
    expect(html).toContain("2h 30m on site");
    expect(html).toContain("form submitted 12 Jul 2026, 12:00 pm");
  });

  it("says 'not clocked out' instead of borrowing the submission time", () => {
    const vm = build({
      timeLogs: [
        { startedAt: new Date("2026-07-11T23:05:00.000Z"), stoppedAt: null, durationM: null },
      ],
    });
    const html = renderEstateReport(vm, ctx);
    expect(html).toContain("Clock-out:</strong> not clocked out");
  });

  it("renders photos uncropped inside links that open each image separately", () => {
    const html = renderEstateReport(build(), ctx);
    // Every photo is wrapped in its own anchor, like videos.
    expect(html).toContain(
      '<a href="https://cdn/x1.jpg" target="_blank" rel="noreferrer"><img src="https://cdn/x1.jpg"'
    );
    // No fixed-height crop in the photo CSS.
    expect(html).toContain(".est-photo img { width: 100%; height: auto;");
    expect(html).not.toContain("object-fit: cover; border-radius: 12px");
  });

  it("renders the GPS attendance card with map links", () => {
    const vm = build({
      gpsCheckInLat: -33.86881,
      gpsCheckInLng: 151.2093,
      gpsCheckOutLat: -33.8689,
      gpsCheckOutLng: 151.2094,
      gpsDistanceMeters: 34,
    });
    const html = renderEstateReport(vm, ctx);
    expect(html).toContain("<h2>GPS attendance</h2>");
    expect(html).toContain("https://www.google.com/maps?q=-33.86881,151.2093");
    expect(html).toContain("-33.86881, 151.20930");
    expect(html).toContain("Distance from property at check-in");
    // No GPS captured → no card.
    expect(renderEstateReport(build(), ctx)).not.toContain("GPS attendance");
  });

  it("omits theme-hidden sections (supplies, gallery, QA)", () => {
    const vm = build({}, {}, { qa: { score: 80, passed: true, notes: "ok" } });
    const html = renderEstateReport(vm, {
      ...ctx,
      showSupplies: false,
      showGallery: false,
      showQaSummary: false,
    });
    expect(html).not.toContain("<h2>Supplies used</h2>");
    expect(html).not.toContain("<h2>Additional evidence</h2>");
    expect(html).not.toContain("<h2>Quality inspection</h2>");
  });
});
