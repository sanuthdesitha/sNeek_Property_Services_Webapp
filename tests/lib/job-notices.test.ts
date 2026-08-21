import { describe, it, expect } from "vitest";
import { renderJobNotices, noticeItemId, type JobNotice } from "@/lib/jobs/notices";
import { parseJobInternalNotes, serializeJobInternalNotes, defaultJobMeta } from "@/lib/jobs/meta";
import { resolveStartBriefingItems, startBriefingHash, validateStartBriefingAck } from "@/lib/forms/start-briefing";

const notice = (over: Partial<JobNotice> = {}): JobNotice => ({
  id: "n1",
  body: "Side gate key is with the neighbour this week",
  urgency: "INFO",
  ...over,
});

describe("renderJobNotices", () => {
  it("drops notices with no text — an empty row is not information", () => {
    expect(renderJobNotices([notice({ body: "   " })])).toEqual([]);
    expect(renderJobNotices(undefined)).toEqual([]);
  });

  it("puts IMPORTANT above INFO but keeps authored order inside a group", () => {
    const out = renderJobNotices([
      notice({ id: "a", body: "first info" }),
      notice({ id: "b", body: "the dog is inside", urgency: "IMPORTANT" }),
      notice({ id: "c", body: "second info" }),
      notice({ id: "d", body: "lift is out", urgency: "IMPORTANT" }),
    ]);
    expect(out.map((n) => n.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("words an important notice more firmly than an ordinary one", () => {
    const [info] = renderJobNotices([notice()]);
    const [important] = renderJobNotices([notice({ urgency: "IMPORTANT" })]);
    expect(important.title).toMatch(/important/i);
    expect(info.title).not.toMatch(/important/i);
  });

  it("falls back to the ordinary heading for an unrecognised urgency", () => {
    // Stored JSON is not typed. Picking the title with the raw value would
    // leave a hand-edited record with no heading at all.
    const [out] = renderJobNotices([notice({ urgency: "URGENT" as never })]);
    expect(out.title).toBe("Notice for this job");
    expect(out.urgency).toBe("INFO");
  });

  it("attributes a notice to whoever wrote it, and when", () => {
    const [out] = renderJobNotices([
      notice({ authorName: "Sam", createdAt: "2026-08-14T02:00:00.000Z" }),
    ]);
    expect(out.attribution).toMatch(/^Added by Sam · /);
    // Sydney date, not UTC: 02:00Z on the 14th is midday on the 14th in Sydney.
    expect(out.attribution).toContain("14 Aug");
  });

  it("says nothing rather than something wrong when attribution is missing", () => {
    expect(renderJobNotices([notice()])[0].attribution).toBeNull();
    expect(renderJobNotices([notice({ createdAt: "not-a-date" })])[0].attribution).toBeNull();
  });
});

describe("notices survive the job meta round-trip", () => {
  it("stores a notice even when it is the only structured data on the job", () => {
    // The bug this guards: hasStructuredData decides whether the meta is written
    // as JSON or collapsed back to a plain note string. A field missing from
    // that check round-trips to nothing and the notice is silently lost.
    const raw = serializeJobInternalNotes({
      ...defaultJobMeta(),
      notices: [notice({ authorName: "Sam", createdAt: "2026-08-14T02:00:00.000Z" })],
    });
    const back = parseJobInternalNotes(raw);
    expect(back.notices).toHaveLength(1);
    expect(back.notices[0].body).toBe("Side gate key is with the neighbour this week");
    expect(back.notices[0].authorName).toBe("Sam");
    expect(back.notices[0].createdAt).toBe("2026-08-14T02:00:00.000Z");
  });

  it("gives an id to a notice saved without one", () => {
    const back = parseJobInternalNotes(
      JSON.stringify({ version: 1, notices: [{ body: "no id here" }] })
    );
    expect(back.notices[0].id).toBeTruthy();
  });

  it("defaults to an empty list on a job that has never had one", () => {
    expect(parseJobInternalNotes(null).notices).toEqual([]);
    expect(parseJobInternalNotes("a plain legacy note").notices).toEqual([]);
  });
});

describe("notices in the start-of-clean briefing", () => {
  const meta = {
    earlyCheckin: { enabled: false } as any,
    lateCheckout: { enabled: false } as any,
    internalNoteText: "",
    specialRequestTasks: [],
    notices: [notice({ id: "n1" })],
  };

  it("re-shows the notice at start — the job page may have been read days ago", () => {
    const items = resolveStartBriefingItems({ meta });
    expect(items.map((i) => i.id)).toContain(noticeItemId("n1"));
    expect(items[0].source).toBe("NOTICE");
  });

  it("keeps timing rules above notices", () => {
    const items = resolveStartBriefingItems({
      meta: { ...meta, lateCheckout: { enabled: true, preset: "11:00" } as any },
    });
    expect(items[0].source).toBe("TIMING_RULE");
    expect(items[1].source).toBe("NOTICE");
  });

  it("re-arms the gate when a notice is edited after being acknowledged", () => {
    const before = resolveStartBriefingItems({ meta });
    const ack = {
      hash: startBriefingHash(before),
      items: before.map((i) => ({ itemId: i.id })),
    };
    expect(validateStartBriefingAck(before, ack)).toEqual({ ok: true });

    const after = resolveStartBriefingItems({
      meta: { ...meta, notices: [notice({ id: "n1", body: "Key has MOVED — it is under the pot" })] },
    });
    const result = validateStartBriefingAck(after, ack);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("STALE");
  });

  it("does not gate a job that carries nothing", () => {
    expect(resolveStartBriefingItems({ meta: { ...meta, notices: [] } })).toEqual([]);
  });
});

/**
 * REPORTED: cleaners were being shown client/office correspondence before every
 * clean — "client requested a reschedule", "client asked for an ETA", "client
 * asked for the report", the reschedule reason, the approval. None of it is
 * work, and none of it is the cleaner's business.
 *
 * Those rows are stored as JobTasks with visibleToCleaner: false. The briefing
 * filtered on source and approval only, so an APPROVED reschedule request
 * (approved = true, visible = false) walked straight through.
 */
describe("the briefing shows work, not correspondence", () => {
  const meta = {
    earlyCheckin: { enabled: false } as any,
    lateCheckout: { enabled: false } as any,
    internalNoteText: "",
    specialRequestTasks: [],
    notices: [],
  };

  it("hides an approved reschedule request from the cleaner", () => {
    const items = resolveStartBriefingItems({
      meta,
      jobTasks: [
        {
          id: "resched",
          title: "Reschedule requested",
          source: "CLIENT",
          approvalStatus: "APPROVED",
          visibleToCleaner: false,
        },
      ],
    });
    expect(items).toEqual([]);
  });

  it("hides an ETA or report chase", () => {
    const items = resolveStartBriefingItems({
      meta,
      jobTasks: [
        { id: "eta", title: "Client asked for an ETA", source: "CLIENT", approvalStatus: "APPROVED", visibleToCleaner: false },
        { id: "rep", title: "Client asked for the report", source: "CLIENT", approvalStatus: "APPROVED", visibleToCleaner: false },
      ],
    });
    expect(items).toEqual([]);
  });

  it("still shows real work added to the job", () => {
    // The thing the cleaner DOES need: a task someone added for this clean.
    const items = resolveStartBriefingItems({
      meta,
      jobTasks: [
        { id: "t1", title: "Descale the kettle", source: "ADMIN", approvalStatus: "APPROVED", visibleToCleaner: true },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Descale the kettle");
  });

  it("does not read out a task that is already done", () => {
    const items = resolveStartBriefingItems({
      meta,
      jobTasks: [
        { id: "t1", title: "Done already", source: "ADMIN", approvalStatus: "APPROVED", visibleToCleaner: true, executionStatus: "COMPLETED" },
      ],
    });
    expect(items).toEqual([]);
  });

  it("treats an unset visibility as visible, so older rows still work", () => {
    // Only an EXPLICIT false hides a task — undefined must not silently blank
    // out every task written before the field was populated.
    const items = resolveStartBriefingItems({
      meta,
      jobTasks: [{ id: "t1", title: "Legacy task", source: "ADMIN", approvalStatus: "APPROVED" }],
    });
    expect(items).toHaveLength(1);
  });
});

/**
 * The acknowledgement record is the proof a cleaner confirmed they read a
 * safety instruction. The start route always wrote it — but it was never
 * listed in the serialiser, so every write silently dropped it: the gate
 * worked for the request that carried the ack and then forgot it happened.
 */
describe("start-briefing acknowledgements survive a round-trip", () => {
  const ack = {
    "cleaner-1": { hash: "abc123", items: [{ itemId: "notice-1", at: "2026-08-22T01:00:00.000Z" }] },
  };

  it("stores an acknowledgement", () => {
    const raw = serializeJobInternalNotes({ ...defaultJobMeta(), startBriefingAcks: ack });
    expect(parseJobInternalNotes(raw).startBriefingAcks).toEqual(ack);
  });

  it("keeps it when it is the only structured data on the job", () => {
    // The exact failure: with nothing else set, the meta collapsed back to a
    // plain note string and the proof went with it.
    const raw = serializeJobInternalNotes({
      ...defaultJobMeta(),
      internalNoteText: "",
      startBriefingAcks: ack,
    });
    expect(parseJobInternalNotes(raw).startBriefingAcks).toEqual(ack);
  });

  it("does not invent acknowledgements", () => {
    expect(parseJobInternalNotes(null).startBriefingAcks).toEqual({});
    expect(parseJobInternalNotes("a plain legacy note").startBriefingAcks).toEqual({});
    expect(
      parseJobInternalNotes(JSON.stringify({ version: 1, startBriefingAcks: "nope" }))
        .startBriefingAcks
    ).toEqual({});
  });
});

/**
 * A notice's images have to survive the meta round-trip. `normalizeJobNotices`
 * rebuilds each notice field-by-field on BOTH read and write — deliberately, so
 * hand-edited JSON cannot smuggle keys in — which means any field not listed
 * there is dropped silently in both directions. That is the same failure that
 * lost every start-briefing acknowledgement.
 */
describe("notice images survive the round-trip", () => {
  it("keeps the images attached to a notice", () => {
    const raw = serializeJobInternalNotes({
      ...defaultJobMeta(),
      notices: [
        {
          id: "n1",
          body: "Stain by the door — see photo",
          urgency: "IMPORTANT",
          imageUrls: ["https://example.test/a.jpg", "https://example.test/b.jpg"],
        },
      ],
    });
    const back = parseJobInternalNotes(raw);
    expect(back.notices[0].imageUrls).toEqual([
      "https://example.test/a.jpg",
      "https://example.test/b.jpg",
    ]);
  });

  it("renders those images to the cleaner", () => {
    const [rendered] = renderJobNotices([
      {
        id: "n1",
        body: "Stain by the door",
        urgency: "INFO",
        imageUrls: ["https://example.test/a.jpg"],
      },
    ]);
    expect(rendered.imageUrls).toEqual(["https://example.test/a.jpg"]);
  });

  it("treats a notice with no images as having none, not undefined", () => {
    const [rendered] = renderJobNotices([{ id: "n1", body: "text only", urgency: "INFO" }]);
    expect(rendered.imageUrls).toEqual([]);
  });
});
