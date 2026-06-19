// Short-term-rental (Airbnb) cleaning knowledge assessment.
//
// This is the reusable question bank + scored quiz that drives the hiring
// "knowledge / IQ test". The quiz definition is stored on
// HiringPosition.screeningSchema, the applicant's answers go in
// HiringApplication.answers, the numeric result in HiringApplication.screeningScore
// (0-100), and the structured breakdown in HiringApplication.evaluation.
//
// NO schema changes are involved — everything rides on existing Json fields.

export type AssessmentQuestionType = "single" | "multi" | "short";

export type AssessmentOption = {
  id: string;
  label: string;
};

export type AssessmentQuestion = {
  id: string;
  prompt: string;
  type: AssessmentQuestionType;
  /** Category bucket used for the per-category breakdown. */
  category: string;
  /** Human-friendly category label for display. */
  categoryLabel?: string;
  options?: AssessmentOption[];
  /** Correct option id ("single") or option ids ("multi"). Absent for "short". */
  correct?: string | string[];
  /** Relative weight in the score (default 1). Higher = more important. */
  weight?: number;
  explanation?: string;
  placeholder?: string;
  /**
   * When true on a "single"/"multi" question, the applicant is also invited to
   * briefly explain their choice in a free-text box (stored, human-reviewed, not
   * auto-scored). The explain answer lives under `${question.id}__explain`.
   */
  allowExplain?: boolean;
};

export type AssessmentCategoryScore = {
  category: string;
  label: string;
  earned: number;
  possible: number;
  /** 0-100 percentage for the category. */
  score: number;
};

export type AssessmentFlaggedAnswer = {
  id: string;
  prompt: string;
  category: string;
  answer: string;
  /** "short" = a free-text judgement question, "explain" = explain-your-answer note. */
  kind: "short" | "explain";
};

export type AssessmentResult = {
  /** Auto-scored multiple-choice/multi-select percentage, 0-100. */
  score: number;
  earned: number;
  possible: number;
  passThreshold: number;
  passed: boolean;
  band: string;
  categoryScores: AssessmentCategoryScore[];
  strengths: string[];
  weakAreas: string[];
  flagged: AssessmentFlaggedAnswer[];
  autoScoredCount: number;
  totalAutoScored: number;
  answeredCount: number;
  totalQuestions: number;
  /** True when the assessment had at least one auto-scored question to grade. */
  hasAutoScored: boolean;
};

export type AssessmentSchema = {
  version: number;
  model: string;
  title: string;
  intro: string;
  /** Pass mark applied to the auto-scored percentage (0-100). */
  passThreshold: number;
  questions: AssessmentQuestion[];
};

// ─────────────────────────────────────────────
// Category catalogue (stable ids + display labels)
// ─────────────────────────────────────────────

export const ASSESSMENT_CATEGORIES: Record<string, string> = {
  communication: "Guest & Client Communication",
  access: "Key Handling & Access Security",
  reliability: "Reliability & Anti-Forgetting Systems",
  routing: "Drive Time & Routing",
  turnaround: "Turnaround Time & Same-Day Pressure",
  linen: "Linen & Laundry",
  restocking: "Restocking Consumables",
  damage: "Damage Discovery & Reporting",
  documentation: "Photo Documentation",
  scenario: "Scenario Judgement",
  judgement: "Reliability & General Judgement",
};

function categoryLabel(category: string) {
  return ASSESSMENT_CATEGORIES[category] ?? category.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}

// ─────────────────────────────────────────────
// Default question bank (short-term-rental focus)
// ─────────────────────────────────────────────

export function buildAirbnbAssessmentQuestions(): AssessmentQuestion[] {
  return [
    // — Communication & guest management —
    {
      id: "q_comm_guest_channel",
      prompt:
        "A guest texts the number on the welcome card asking when they can check in. What is the correct way to handle it?",
      type: "single",
      category: "communication",
      weight: 2,
      options: [
        { id: "a", label: "Reply directly from your personal phone and arrange it yourself." },
        { id: "b", label: "Do not reply; pass the message to the host/admin through the approved channel and keep cleaning." },
        { id: "c", label: "Tell them to check in whenever the property looks ready." },
        { id: "d", label: "Ignore it — guest messages are not your job." },
      ],
      correct: "b",
      explanation:
        "Cleaners route guest contact through the host/admin so messaging stays consistent and on the record. You never freelance check-in times from a personal phone.",
    },
    {
      id: "q_comm_running_late",
      prompt: "You realise you will finish a turnover about 40 minutes later than planned. What should you do first?",
      type: "single",
      category: "communication",
      weight: 2,
      options: [
        { id: "a", label: "Say nothing and hope you catch up." },
        { id: "b", label: "Notify admin/host as early as possible with a realistic finish time." },
        { id: "c", label: "Skip the final checks so you finish on time." },
        { id: "d", label: "Wait until you are already late, then explain." },
      ],
      correct: "b",
      explanation: "Early, honest communication lets the host manage the incoming guest. Surprises at the last minute are the real failure.",
    },
    {
      id: "q_comm_tone",
      prompt: "Select all of the things that make written updates to a host genuinely useful.",
      type: "multi",
      category: "communication",
      weight: 2,
      options: [
        { id: "a", label: "Specific facts (what, where, how bad)." },
        { id: "b", label: "A photo when it helps show the issue." },
        { id: "c", label: "Vague phrases like “it was a bit messy”." },
        { id: "d", label: "What you have already done about it." },
      ],
      correct: ["a", "b", "d"],
      explanation: "Concrete facts, evidence, and the action you took make a report actionable. Vague descriptions force the host to chase you.",
    },

    // — Key handling & lockboxes —
    {
      id: "q_access_leave_key",
      prompt: "You finish a job at a property that uses a lockbox for the key. How do you leave the key safely?",
      type: "single",
      category: "access",
      weight: 3,
      options: [
        { id: "a", label: "Leave it under the doormat so the guest can find it easily." },
        { id: "b", label: "Return it to the lockbox, scramble the dials/clear the code, and confirm it is locked shut." },
        { id: "c", label: "Take it home and drop it back next time you are nearby." },
        { id: "d", label: "Leave it on the kitchen bench inside the unit." },
      ],
      correct: "b",
      explanation: "The key goes back in the lockbox, the code is scrambled, and the box is confirmed locked. Doormats and benches defeat the point of secure access.",
    },
    {
      id: "q_access_no_key",
      prompt: "You arrive and the key is not where the access notes said it would be. What is the correct first action?",
      type: "single",
      category: "access",
      weight: 3,
      options: [
        { id: "a", label: "Try windows and back doors in case one is open." },
        { id: "b", label: "Use a code you remember from a different property nearby." },
        { id: "c", label: "Stop, do not improvise entry, and escalate through the approved contact path." },
        { id: "d", label: "Leave and mark the job complete." },
      ],
      correct: "c",
      explanation: "Never improvise entry. Escalate immediately so the host can sort access — forcing entry or guessing codes is a serious risk.",
    },
    {
      id: "q_access_code_handling",
      prompt: "Select all correct practices for handling access codes and keys.",
      type: "multi",
      category: "access",
      weight: 2,
      options: [
        { id: "a", label: "Never share property codes in group chats or with people outside the job." },
        { id: "b", label: "Confirm the door is actually locked before you leave." },
        { id: "c", label: "Photograph the lockbox code and post it for convenience." },
        { id: "d", label: "Report immediately if a code does not work so it can be reset." },
      ],
      correct: ["a", "b", "d"],
      explanation: "Codes stay private, doors get checked, and broken codes get reported. Posting a code anywhere is a security breach.",
    },

    // — Reliability & anti-forgetting systems —
    {
      id: "q_reliability_missed_job",
      prompt: "You realise you completely missed a scheduled turnover from earlier today. What is the right response?",
      type: "single",
      category: "reliability",
      weight: 3,
      options: [
        { id: "a", label: "Say nothing and hope nobody booked that night." },
        { id: "b", label: "Immediately tell admin so they can arrange cover or a recovery clean before the guest arrives." },
        { id: "c", label: "Quietly go now without telling anyone, even if a guest may already be there." },
        { id: "d", label: "Wait until tomorrow and apologise then." },
      ],
      correct: "b",
      explanation: "A missed job is a guest-facing emergency. The damage-control window is now — admin needs to know instantly to arrange cover.",
    },
    {
      id: "q_reliability_systems",
      prompt: "Select all of the systems/habits that genuinely help you NOT forget or miss jobs.",
      type: "multi",
      category: "reliability",
      weight: 2,
      options: [
        { id: "a", label: "Checking the app schedule at the start of each day and the night before." },
        { id: "b", label: "Setting phone reminders/alarms for each job and travel start time." },
        { id: "c", label: "Relying purely on memory." },
        { id: "d", label: "Confirming the next day’s jobs and addresses the evening before." },
      ],
      correct: ["a", "b", "d"],
      explanation: "Reliable cleaners use the schedule, reminders, and an evening review. “I’ll just remember” is how jobs get missed.",
    },
    {
      id: "q_reliability_double_book",
      prompt: "Two jobs you have been assigned overlap and you physically cannot do both on time. What do you do?",
      type: "single",
      category: "reliability",
      weight: 2,
      options: [
        { id: "a", label: "Pick the closer one and silently skip the other." },
        { id: "b", label: "Flag the clash to admin as soon as you spot it so one can be reassigned or re-timed." },
        { id: "c", label: "Rush both and cut corners on each." },
        { id: "d", label: "Do one today and the other tomorrow without asking." },
      ],
      correct: "b",
      explanation: "Spotting and flagging a clash early lets admin reassign. Silent skipping leaves a guest walking into a dirty property.",
    },

    // — Drive time & routing —
    {
      id: "q_routing_plan",
      prompt: "You have three turnovers across different suburbs today. How should you plan drive time and routing?",
      type: "single",
      category: "routing",
      weight: 2,
      options: [
        { id: "a", label: "Do them in the order they were assigned regardless of distance." },
        { id: "b", label: "Sequence by check-out/check-in deadlines and geography, allowing buffer for traffic between stops." },
        { id: "c", label: "Start with the furthest one because it is the most interesting." },
        { id: "d", label: "Decide on the day with no plan." },
      ],
      correct: "b",
      explanation: "Routing is driven by deadlines first, then geography, with traffic buffers. Same-day check-ins set the hard constraints.",
    },
    {
      id: "q_routing_buffer",
      prompt: "Why do you build a travel buffer between back-to-back turnovers?",
      type: "single",
      category: "routing",
      weight: 1,
      options: [
        { id: "a", label: "So you can take a long lunch." },
        { id: "b", label: "Because parking, traffic, and a job running long are normal — buffers protect the later same-day check-ins." },
        { id: "c", label: "Buffers are not needed if you drive fast." },
        { id: "d", label: "To make the day look busier." },
      ],
      correct: "b",
      explanation: "Real-world delays (parking, traffic, a messier-than-expected unit) are normal. A buffer keeps a single slip from cascading into a late check-in.",
    },

    // — Turnaround time & same-day check-ins —
    {
      id: "q_turnaround_late_checkout",
      prompt:
        "A same-day check-in is due at 2:00 PM, but the previous guest only leaves at 12:30 PM, giving you a tight window. What happens first?",
      type: "single",
      category: "turnaround",
      weight: 3,
      options: [
        { id: "a", label: "Start cleaning the rooms furthest from the door and tell no one." },
        { id: "b", label: "Flag the tight turnaround to admin/host immediately, then prioritise the highest-impact guest-ready tasks." },
        { id: "c", label: "Skip linen and restocking so it finishes faster." },
        { id: "d", label: "Mark it done later if it mostly looks fine." },
      ],
      correct: "b",
      explanation: "Communicate the squeeze first so the host can manage the guest, then work the highest-impact tasks. Never silently drop linen or stock.",
    },
    {
      id: "q_turnaround_priorities",
      prompt: "Under real time pressure on a same-day turnover, which areas are highest priority to get guest-ready?",
      type: "multi",
      category: "turnaround",
      weight: 2,
      options: [
        { id: "a", label: "Beds made with fresh linen." },
        { id: "b", label: "Bathrooms reset and sanitised." },
        { id: "c", label: "Kitchen surfaces and visible benchtops." },
        { id: "d", label: "Reorganising the host’s storage cupboard." },
      ],
      correct: ["a", "b", "c"],
      explanation: "Beds, bathrooms and kitchen drive guest first impressions and reviews. Non-guest-facing extras wait until the essentials are done.",
    },

    // — Linen & laundry —
    {
      id: "q_linen_doubt",
      prompt: "A fitted sheet looks mostly clean but has a faint hair and a light mark near the pillow. What do you do?",
      type: "single",
      category: "linen",
      weight: 2,
      options: [
        { id: "a", label: "Use it — most guests will not notice." },
        { id: "b", label: "Replace it with fresh linen; guest-ready means visibly fresh, not “mostly clean”." },
        { id: "c", label: "Flip it over and hope the mark is hidden." },
        { id: "d", label: "Tuck the marked side under the mattress." },
      ],
      correct: "b",
      explanation: "If linen is not clearly fresh, it gets replaced. Guests photograph beds — a faint hair or mark shows up in reviews.",
    },
    {
      id: "q_linen_handoff",
      prompt: "Select all correct practices for handling used linen and the laundry handoff.",
      type: "multi",
      category: "linen",
      weight: 2,
      options: [
        { id: "a", label: "Bag used linen separately from clean stock." },
        { id: "b", label: "Record/flag the laundry status and bag location for pickup." },
        { id: "c", label: "Leave wet/soiled linen piled on a clean bed." },
        { id: "d", label: "Send the laundry update early if it is time-critical, rather than waiting for the whole job to finish." },
      ],
      correct: ["a", "b", "d"],
      explanation: "Separate clean and used, record the handoff, and don’t let urgent laundry wait on the rest of the form. Never dump soiled linen on clean surfaces.",
    },

    // — Restocking consumables —
    {
      id: "q_restock_out",
      prompt: "The property is down to its last toilet roll and there is no backup stock for tomorrow’s guest. What is correct?",
      type: "single",
      category: "restocking",
      weight: 2,
      options: [
        { id: "a", label: "Leave it and mention it only if someone asks." },
        { id: "b", label: "Raise the stock/restock signal immediately so it can be solved before the next arrival." },
        { id: "c", label: "Take stock from another property without recording it." },
        { id: "d", label: "Assume the guest will buy their own." },
      ],
      correct: "b",
      explanation: "Flag low/critical stock immediately while there is still time to restock. Silent shortages and unrecorded “borrowing” both fail the next guest.",
    },
    {
      id: "q_restock_prep_count",
      prompt: "With no incoming guest details for a non-same-day turnover, what guest count do you restock and set up for?",
      type: "single",
      category: "restocking",
      weight: 1,
      options: [
        { id: "a", label: "The count of the guest who just left." },
        { id: "b", label: "The property’s maximum guest capacity." },
        { id: "c", label: "Two people by default." },
        { id: "d", label: "Whatever stock happens to be left." },
      ],
      correct: "b",
      explanation: "Prepare for the incoming guest, not the one who left. With no details, the property’s max capacity is the safe default.",
    },

    // — Damage discovery & reporting —
    {
      id: "q_damage_discovery",
      prompt: "You discover a cracked glass cooktop that the previous guest clearly damaged. What is the right process?",
      type: "single",
      category: "damage",
      weight: 3,
      options: [
        { id: "a", label: "Clean around it and say nothing — maintenance is not cleaning." },
        { id: "b", label: "Document it with photos and report it through the app/admin as damage so the host can act." },
        { id: "c", label: "Try to fix it yourself." },
        { id: "d", label: "Mention it verbally to the next cleaner only." },
      ],
      correct: "b",
      explanation: "Damage gets photographed and reported through the system so the host can claim/repair. Undocumented damage becomes the cleaner’s problem.",
    },
    {
      id: "q_damage_left_behind",
      prompt: "You find a guest has left behind a phone charger and a jacket. What do you do?",
      type: "single",
      category: "damage",
      weight: 1,
      options: [
        { id: "a", label: "Keep them — finders keepers." },
        { id: "b", label: "Bag the items, note and photograph them, and report the lost property through the proper channel." },
        { id: "c", label: "Throw them out to keep the place tidy." },
        { id: "d", label: "Leave them where they are for the next guest." },
      ],
      correct: "b",
      explanation: "Lost property is bagged, recorded, and reported so it can be returned. Binning or keeping items both create trust problems.",
    },

    // — Photo documentation —
    {
      id: "q_docs_photos",
      prompt: "Which statements about photo documentation on a turnover are correct? Select all that apply.",
      type: "multi",
      category: "documentation",
      weight: 2,
      options: [
        { id: "a", label: "Photograph finished beds, bathrooms and kitchen as proof of guest-ready condition." },
        { id: "b", label: "Photograph any damage, stains, or issues before and (where relevant) after." },
        { id: "c", label: "Photos are optional and only for special jobs." },
        { id: "d", label: "Provide photo proof where the job/task specifically requires it." },
      ],
      correct: ["a", "b", "d"],
      explanation: "Photos prove the work and protect everyone if a guest complains. They are part of the standard job, not an optional extra.",
    },

    // — Scenario judgement —
    {
      id: "q_scenario_early_checkin",
      prompt: "A guest turns up wanting to check in early, while you are still mid-clean. What is the best response?",
      type: "single",
      category: "scenario",
      weight: 2,
      options: [
        { id: "a", label: "Let them straight in to avoid a confrontation." },
        { id: "b", label: "Stay polite, do not grant access yourself, and contact admin/host to decide while you keep working." },
        { id: "c", label: "Tell them to come back in three hours and shut the door." },
        { id: "d", label: "Stop cleaning and leave so they can settle in." },
      ],
      correct: "b",
      explanation: "Early access is the host’s call, not the cleaner’s. Stay courteous, keep working, and let admin decide whether to allow it.",
    },
    {
      id: "q_scenario_trashed",
      prompt:
        "You arrive to a heavily trashed property (party damage, far beyond a normal turnover) with a same-day check-in booked. What do you do?",
      type: "single",
      category: "scenario",
      weight: 3,
      options: [
        { id: "a", label: "Quietly do your best in the normal time and leave whatever you can’t finish." },
        { id: "b", label: "Stop and document the state with photos, alert admin immediately so the incoming booking and extra time/cost can be managed, then work to plan." },
        { id: "c", label: "Refuse the job and drive off." },
        { id: "d", label: "Start cleaning without telling anyone how bad it is." },
      ],
      correct: "b",
      explanation: "A trashed property is an immediate escalation: document, alert admin so the check-in is handled, agree a plan. Silently absorbing it sets up a failed turnover.",
    },
    {
      id: "q_scenario_special_task",
      prompt: "Admin has added a specific requested task (e.g. clean inside the oven) to the job. Select all correct statements.",
      type: "multi",
      category: "scenario",
      weight: 2,
      options: [
        { id: "a", label: "It is required work for that job." },
        { id: "b", label: "Provide photo proof if the task asks for it." },
        { id: "c", label: "It can be skipped if the rest of the standard tasks are done." },
        { id: "d", label: "Leave it blank if you are running a little late." },
      ],
      correct: ["a", "b"],
      explanation: "Requested tasks are mandatory and may need photo proof. Being busy does not make them optional.",
    },

    // — Free-text judgement (NOT auto-scored, flagged for human review) —
    {
      id: "q_short_guest_ready",
      prompt:
        "In your own words: what makes a property genuinely “guest-ready”, rather than just technically cleaned? (Reviewed by our team.)",
      type: "short",
      category: "judgement",
      placeholder: "A sentence or two on the standard you work to.",
    },
    {
      id: "q_short_reliability",
      prompt:
        "Describe how you personally make sure you never forget or miss a booked job. What is your actual system? (Reviewed by our team.)",
      type: "short",
      category: "reliability",
      placeholder: "Reminders, schedule checks, evening review — tell us what you really do.",
    },
  ];
}

export function buildDefaultScreeningSchema(): AssessmentSchema {
  return {
    version: 2,
    model: "airbnb_cleaning_knowledge_v1",
    title: "Short-Stay Cleaning Knowledge Check",
    intro:
      "A short assessment on the realities of short-term-rental (Airbnb) turnovers: communication, access security, reliability, routing, time pressure, linen, restocking, damage, and judgement. Answer honestly — we are looking for sound judgement, not perfect exam technique.",
    passThreshold: 65,
    questions: buildAirbnbAssessmentQuestions(),
  };
}

// ─────────────────────────────────────────────
// Parsing / normalisation
// ─────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeQuestion(raw: unknown): AssessmentQuestion | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const type = raw.type === "multi" || raw.type === "short" ? raw.type : "single";
  if (!id || !prompt) return null;
  const category = typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : "judgement";
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((opt) => (isRecord(opt) ? { id: String(opt.id ?? ""), label: String(opt.label ?? "") } : null))
        .filter((opt): opt is AssessmentOption => Boolean(opt && opt.id))
    : undefined;
  const correct =
    type === "multi"
      ? Array.isArray(raw.correct)
        ? raw.correct.map(String)
        : typeof raw.correct === "string"
          ? raw.correct.split(",").map((v) => v.trim()).filter(Boolean)
          : undefined
      : typeof raw.correct === "string"
        ? raw.correct
        : undefined;
  return {
    id,
    prompt,
    type,
    category,
    categoryLabel: typeof raw.categoryLabel === "string" ? raw.categoryLabel : categoryLabel(category),
    options,
    correct,
    weight: Number.isFinite(Number(raw.weight)) && Number(raw.weight) > 0 ? Number(raw.weight) : 1,
    explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
    placeholder: typeof raw.placeholder === "string" ? raw.placeholder : undefined,
    allowExplain: raw.allowExplain === true,
  };
}

/**
 * Parse a stored screeningSchema (HiringPosition.screeningSchema) into a usable
 * AssessmentSchema. Falls back to the default question bank if the stored value
 * is the legacy marker (`{ model: "default_cleaner_screening_v1" }`) or empty.
 *
 * `requireKnowledgeTest` is read from the stored value; when the position has the
 * test explicitly disabled, this returns null.
 */
export function parseScreeningSchema(value: unknown): AssessmentSchema | null {
  if (!isRecord(value)) {
    // No stored schema at all → use the strong default.
    return buildDefaultScreeningSchema();
  }
  if (value.requireKnowledgeTest === false) {
    return null;
  }
  const questions = Array.isArray(value.questions)
    ? value.questions.map(normalizeQuestion).filter((q): q is AssessmentQuestion => Boolean(q))
    : [];
  if (questions.length === 0) {
    // Legacy marker schemas (`{ model: "default_cleaner_screening_v1" }`) and
    // anything without questions inherit the default bank.
    const fallback = buildDefaultScreeningSchema();
    return {
      ...fallback,
      passThreshold: Number.isFinite(Number(value.passThreshold)) ? clampPercent(Number(value.passThreshold)) : fallback.passThreshold,
      title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : fallback.title,
      intro: typeof value.intro === "string" && value.intro.trim() ? value.intro.trim() : fallback.intro,
    };
  }
  return {
    version: Number.isFinite(Number(value.version)) ? Number(value.version) : 2,
    model: typeof value.model === "string" && value.model.trim() ? value.model.trim() : "custom",
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : "Knowledge Check",
    intro: typeof value.intro === "string" ? value.intro : "",
    passThreshold: Number.isFinite(Number(value.passThreshold)) ? clampPercent(Number(value.passThreshold)) : 65,
    questions,
  };
}

/** Build a stored screeningSchema value for a position from admin input. */
export function buildScreeningSchemaForStorage(input: {
  requireKnowledgeTest?: boolean;
  passThreshold?: number | null;
  // Custom question bank is supported but optional; default bank is used otherwise.
  questions?: AssessmentQuestion[] | null;
  title?: string | null;
  intro?: string | null;
}): Record<string, unknown> {
  const base = buildDefaultScreeningSchema();
  const requireKnowledgeTest = input.requireKnowledgeTest !== false;
  return {
    version: base.version,
    model: base.model,
    requireKnowledgeTest,
    title: input.title?.trim() || base.title,
    intro: input.intro?.trim() || base.intro,
    passThreshold:
      typeof input.passThreshold === "number" && Number.isFinite(input.passThreshold)
        ? clampPercent(input.passThreshold)
        : base.passThreshold,
    questions: Array.isArray(input.questions) && input.questions.length > 0 ? input.questions : base.questions,
  };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ─────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────

function scoreSingle(question: AssessmentQuestion, answer: unknown, weight: number) {
  if (typeof answer === "string" && typeof question.correct === "string" && answer.trim() === question.correct) {
    return weight;
  }
  return 0;
}

function scoreMulti(question: AssessmentQuestion, answer: unknown, weight: number) {
  const expected = Array.isArray(question.correct) ? question.correct.map(String) : [];
  if (expected.length === 0) return 0;
  const actual = Array.isArray(answer)
    ? answer.map(String).filter(Boolean)
    : typeof answer === "string"
      ? answer.split(",").map((v) => v.trim()).filter(Boolean)
      : [];
  if (actual.length === 0) return 0;
  const correctHits = actual.filter((v) => expected.includes(v)).length;
  const wrongHits = actual.filter((v) => !expected.includes(v)).length;
  const coverage = correctHits / expected.length;
  // Each wrong selection costs 25% of the question — discourages "select all".
  const penalty = wrongHits * 0.25;
  return Math.max(0, Math.min(1, coverage - penalty)) * weight;
}

/**
 * Auto-score the multiple-choice / multi-select portion of an assessment and
 * produce the structured breakdown stored in HiringApplication.evaluation.
 *
 * - `score` is the 0-100 percentage over auto-scored weight.
 * - "short" questions and explain-your-answer notes are NOT scored; they are
 *   collected in `flagged` for human review.
 */
export function scoreAssessment(schema: AssessmentSchema, answersRaw: unknown): AssessmentResult {
  const answers = isRecord(answersRaw) ? answersRaw : {};
  const categoryTotals = new Map<string, { earned: number; possible: number }>();
  const flagged: AssessmentFlaggedAnswer[] = [];

  let earned = 0;
  let possible = 0;
  let autoScoredCount = 0;
  let totalAutoScored = 0;
  let answeredCount = 0;

  for (const question of schema.questions) {
    const weight = Number.isFinite(Number(question.weight)) && Number(question.weight) > 0 ? Number(question.weight) : 1;
    const answer = answers[question.id];
    const hasAnswer = Array.isArray(answer) ? answer.length > 0 : typeof answer === "string" ? answer.trim().length > 0 : Boolean(answer);
    if (hasAnswer) answeredCount += 1;

    if (question.type === "short") {
      const text = typeof answer === "string" ? answer.trim() : "";
      if (text) {
        flagged.push({ id: question.id, prompt: question.prompt, category: question.category, answer: text, kind: "short" });
      }
      continue;
    }

    // Auto-scored question (single / multi)
    totalAutoScored += 1;
    possible += weight;
    const questionScore = question.type === "multi" ? scoreMulti(question, answer, weight) : scoreSingle(question, answer, weight);
    if (questionScore >= weight - 1e-9) autoScoredCount += 1;
    earned += questionScore;

    const bucket = categoryTotals.get(question.category) ?? { earned: 0, possible: 0 };
    bucket.earned += questionScore;
    bucket.possible += weight;
    categoryTotals.set(question.category, bucket);

    // Optional explain-your-answer note → flagged for human review.
    const explain = answers[`${question.id}__explain`];
    if (typeof explain === "string" && explain.trim()) {
      flagged.push({ id: `${question.id}__explain`, prompt: question.prompt, category: question.category, answer: explain.trim(), kind: "explain" });
    }
  }

  const score = possible > 0 ? clampPercent((earned / possible) * 100) : 0;
  const passThreshold = clampPercent(schema.passThreshold ?? 65);
  const categoryScores: AssessmentCategoryScore[] = Array.from(categoryTotals.entries()).map(([category, totals]) => ({
    category,
    label: categoryLabel(category),
    earned: Number(totals.earned.toFixed(2)),
    possible: Number(totals.possible.toFixed(2)),
    score: totals.possible > 0 ? clampPercent((totals.earned / totals.possible) * 100) : 0,
  }));

  const strengths = categoryScores.filter((c) => c.score >= 80).map((c) => c.label);
  const weakAreas = categoryScores.filter((c) => c.score < 60).map((c) => c.label);

  let band = "Needs screening review";
  if (score >= 85) band = "Strong knowledge";
  else if (score >= passThreshold) band = "Solid — worth interviewing";
  else if (score >= Math.max(40, passThreshold - 20)) band = "Borderline — coaching required";
  else band = "Below standard";

  return {
    score,
    earned: Number(earned.toFixed(2)),
    possible: Number(possible.toFixed(2)),
    passThreshold,
    passed: possible > 0 ? score >= passThreshold : false,
    band,
    categoryScores,
    strengths,
    weakAreas,
    flagged,
    autoScoredCount,
    totalAutoScored,
    answeredCount,
    totalQuestions: schema.questions.length,
    hasAutoScored: possible > 0,
  };
}

// ─────────────────────────────────────────────
// Strengthened default application schema (structured + validated)
// ─────────────────────────────────────────────

export type ApplicationFieldType = "text" | "email" | "phone" | "single" | "multi" | "longText" | "file" | "number";

export type ApplicationField = {
  id: string;
  label: string;
  type: ApplicationFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  helper?: string;
};

export type ApplicationStep = {
  id: string;
  title: string;
  description?: string;
  fields: ApplicationField[];
};

export type ApplicationSchema = {
  version: number;
  steps: ApplicationStep[];
  /** Optional large banner image (e.g. the hiring flyer) shown atop the form. */
  heroImageUrl?: string | null;
};

/**
 * Lean default applicationSchema — quick to fill (mostly taps), but still
 * captures the operational basics we need to shortlist an Airbnb cleaner:
 * who/where, work rights, transport, availability, and experience. Heavier
 * detail (ABN, licence, references, equipment) is collected at onboarding AFTER
 * a hire, not up front, so we don't lose good applicants to a long form.
 * Custom positions can still override this; the public form renders whatever
 * steps/fields are present.
 */
export function buildStructuredApplicationSchema(heroImageUrl?: string | null): ApplicationSchema {
  return {
    version: 3,
    heroImageUrl: heroImageUrl?.trim() || null,
    steps: [
      {
        id: "contact",
        title: "About you",
        description: "Just the basics so we can reach you.",
        fields: [
          { id: "fullName", label: "Full name", type: "text", required: true },
          { id: "phone", label: "Mobile number", type: "phone", required: true, placeholder: "04xx xxx xxx" },
          { id: "email", label: "Email", type: "email", required: true },
          { id: "suburb", label: "Suburb you live in", type: "text", required: true, placeholder: "Helps us match nearby jobs" },
        ],
      },
      {
        id: "fit",
        title: "Can you do the role?",
        description: "A few quick taps — no typing.",
        fields: [
          {
            id: "rightToWork",
            label: "Do you have the right to work in Australia?",
            type: "single",
            required: true,
            options: ["Yes — citizen / PR", "Yes — work or student visa", "No / not sure"],
          },
          {
            id: "hasCar",
            label: "Do you have your own transport to get to jobs?",
            type: "single",
            required: true,
            options: ["Yes — own car", "Public transport / shared", "No"],
          },
          {
            id: "availabilityDays",
            label: "Which days can you usually work? (2–3+ needed)",
            type: "multi",
            required: true,
            options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
          },
          {
            id: "middayHours",
            label: "Most cleans run ~10am–3pm. Does that suit you?",
            type: "single",
            required: true,
            options: ["Yes, most days", "Some days", "Not usually"],
          },
          {
            id: "yearsExperience",
            label: "Cleaning experience",
            type: "single",
            required: true,
            options: ["New to it (keen to learn)", "Under 1 year", "1–3 years", "3+ years"],
          },
        ],
      },
      {
        id: "extras",
        title: "Anything else? (optional)",
        fields: [
          {
            id: "experienceTypes",
            label: "Done any of these before?",
            type: "multi",
            options: ["Airbnb / short-stay", "Residential", "End of lease", "Deep cleans", "Laundry / linen"],
          },
          { id: "resumeUrl", label: "Resume / CV — optional", type: "file" },
        ],
      },
    ],
  };
}
