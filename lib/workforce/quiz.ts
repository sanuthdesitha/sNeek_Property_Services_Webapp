import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/notifications/email";
import { appBaseUrl } from "@/lib/auth/recovery";
import { logHiringEvent } from "@/lib/workforce/service";
import { scoreAssessment, type AssessmentQuestion, type AssessmentSchema } from "@/lib/workforce/assessment";

// ── Default short Airbnb-cleaner quizzes (seeded into QuizTemplate) ───────────

function q(p: Partial<AssessmentQuestion> & { id: string; prompt: string; type: AssessmentQuestion["type"] }): AssessmentQuestion {
  return { category: "judgement", weight: 1, ...p } as AssessmentQuestion;
}

function schema(title: string, intro: string, passThreshold: number, questions: AssessmentQuestion[]): AssessmentSchema {
  return { version: 1, model: "airbnb-cleaner-quiz-v1", title, intro, passThreshold, questions };
}

export const DEFAULT_QUIZ_TEMPLATES: Array<{ name: string; description: string; schema: AssessmentSchema }> = [
  {
    name: "Airbnb Turnover Essentials",
    description: "Core short-stay turnover judgement — speed, standards, and what to never skip.",
    schema: schema("Airbnb Turnover Essentials", "A few quick questions about short-stay turnovers.", 70, [
      q({
        id: "te_priority", category: "turnaround", weight: 2, type: "single",
        prompt: "Guest checks out at 10am and the next guest checks in at 3pm. What's your priority?",
        options: [
          { id: "a", label: "Reset the whole property — beds, bathrooms, kitchen, restock — before the deadline." },
          { id: "b", label: "Do a quick tidy and leave the rest for next time." },
          { id: "c", label: "Rearrange the furniture to a new layout." },
        ],
        correct: "a",
      }),
      q({
        id: "te_checks", category: "documentation", weight: 2, type: "multi",
        prompt: "Before you leave a turnover, which must you always check? (select all)",
        options: [
          { id: "beds", label: "Beds made to standard" },
          { id: "bins", label: "Bins emptied" },
          { id: "locked", label: "All doors and windows locked" },
          { id: "restock", label: "Amenities restocked" },
          { id: "note", label: "Leave a personal note for the guest" },
        ],
        correct: ["beds", "bins", "locked", "restock"],
      }),
      q({
        id: "te_valuables", category: "judgement", type: "single",
        prompt: "You find valuables the previous guest left behind. What do you do?",
        options: [
          { id: "a", label: "Take them home and return them later." },
          { id: "b", label: "Leave them, log it, and notify admin/host through the approved channel." },
          { id: "c", label: "Throw them out so the unit is clear." },
        ],
        correct: "b",
      }),
      q({
        id: "te_linen", category: "linen", type: "single",
        prompt: "You run out of clean linen mid-turnover. Best move?",
        options: [
          { id: "a", label: "Reuse the least-dirty sheets." },
          { id: "b", label: "Notify admin immediately and follow the backup linen plan." },
          { id: "c", label: "Leave the beds unmade." },
        ],
        correct: "b",
      }),
      q({ id: "te_bath", category: "scenario", type: "short", prompt: "In one sentence, how do you make a bathroom look hotel-ready?", placeholder: "Your answer" }),
    ]),
  },
  {
    name: "Guest-Ready Detail Check",
    description: "Attention to detail and presentation — what separates 'clean' from 'guest-ready'.",
    schema: schema("Guest-Ready Detail Check", "How sharp is your eye for detail?", 75, [
      q({
        id: "gr_signs", category: "documentation", weight: 2, type: "multi",
        prompt: "Which of these mean a clean is NOT guest-ready? (select all)",
        options: [
          { id: "mirror", label: "Streaky mirrors" },
          { id: "hair", label: "Hair in the shower" },
          { id: "dust", label: "Dusty surfaces" },
          { id: "cushions", label: "Crooked, un-fluffed cushions" },
          { id: "fresh", label: "A fresh, neutral smell" },
        ],
        correct: ["mirror", "hair", "dust", "cushions"],
      }),
      q({
        id: "gr_towels", category: "judgement", type: "single",
        prompt: "How should towels be presented?",
        options: [
          { id: "a", label: "Folded or rolled consistently to the property standard." },
          { id: "b", label: "However is quickest." },
          { id: "c", label: "Left in the dryer for the guest." },
        ],
        correct: "a",
      }),
      q({
        id: "gr_stain", category: "damage", type: "single",
        prompt: "You notice a stain you can't remove. What do you do?",
        options: [
          { id: "a", label: "Hide it by moving a rug or cushion over it." },
          { id: "b", label: "Photograph it, flag it, and report it." },
          { id: "c", label: "Ignore it." },
        ],
        correct: "b",
      }),
      q({ id: "gr_firstlook", category: "scenario", type: "short", prompt: "What's the first thing a guest notices walking in, and how do you nail it?", placeholder: "Your answer" }),
    ]),
  },
  {
    name: "Reliability & Communication",
    description: "The soft skills that keep guests happy and admins informed.",
    schema: schema("Reliability & Communication", "How you handle timing and messages.", 70, [
      q({
        id: "rc_late", category: "reliability", weight: 2, type: "single",
        prompt: "You're running 20 minutes late. What's best?",
        options: [
          { id: "a", label: "Say nothing and hope to catch up." },
          { id: "b", label: "Notify admin/host as early as possible with a realistic finish time." },
          { id: "c", label: "Skip the final checks to finish on time." },
        ],
        correct: "b",
      }),
      q({
        id: "rc_guest", category: "communication", type: "single",
        prompt: "A guest messages you directly during a clean. What do you do?",
        options: [
          { id: "a", label: "Reply from your personal phone and sort it yourself." },
          { id: "b", label: "Pass it to admin/host through the approved channel and keep working." },
          { id: "c", label: "Ignore it completely." },
        ],
        correct: "b",
      }),
      q({
        id: "rc_standard", category: "reliability", type: "single",
        prompt: "You realise you can't finish to standard before check-in. When do you tell admin?",
        options: [
          { id: "a", label: "Before the deadline, so they can help." },
          { id: "b", label: "After you've already missed it." },
          { id: "c", label: "Only if they ask." },
        ],
        correct: "a",
      }),
      q({
        id: "rc_photo", category: "documentation", type: "multi",
        prompt: "Good photo evidence is… (select all)",
        options: [
          { id: "clear", label: "Clear and well-lit" },
          { id: "whole", label: "Shows the whole area" },
          { id: "ba", label: "Before/after where it helps" },
          { id: "blurry", label: "Quick and blurry is fine" },
        ],
        correct: ["clear", "whole", "ba"],
      }),
    ]),
  },
  {
    name: "Safety & Access",
    description: "Keys, codes, and keeping properties secure.",
    schema: schema("Safety & Access", "Keeping access and safety tight.", 80, [
      q({
        id: "sa_key", category: "access", weight: 2, type: "single",
        prompt: "You used a key from a lockbox. What do you do when leaving?",
        options: [
          { id: "a", label: "Leave it under the doormat." },
          { id: "b", label: "Return it to the lockbox, scramble the code, and confirm it's locked." },
          { id: "c", label: "Keep it for next time." },
        ],
        correct: "b",
      }),
      q({
        id: "sa_code", category: "access", type: "single",
        prompt: "A door code doesn't work. What's the right move?",
        options: [
          { id: "a", label: "Try windows and back doors." },
          { id: "b", label: "Use a code you remember from another property." },
          { id: "c", label: "Stop, don't improvise entry, and escalate through the approved contact." },
        ],
        correct: "c",
      }),
      q({
        id: "sa_codes_never", category: "access", weight: 2, type: "multi",
        prompt: "What should you NEVER do with property codes? (select all)",
        options: [
          { id: "share", label: "Share them in group chats" },
          { id: "post", label: "Post them for convenience" },
          { id: "outside", label: "Give them to people outside the job" },
          { id: "confirm", label: "Confirm the door is locked before leaving" },
        ],
        correct: ["share", "post", "outside"],
      }),
      q({
        id: "sa_gas", category: "judgement", type: "single",
        prompt: "You smell gas in the property. What do you do?",
        options: [
          { id: "a", label: "Open a window and keep cleaning." },
          { id: "b", label: "Leave, don't use switches, call the emergency line, and notify admin." },
          { id: "c", label: "Light a candle to mask it." },
        ],
        correct: "b",
      }),
    ]),
  },
  {
    name: "Eye for Detail Challenge",
    description: "Tricky spot-the-miss scenarios — the small things guests notice and reviews punish.",
    schema: schema(
      "Eye for Detail Challenge",
      "These are deliberately tricky. Read each scenario carefully before answering.",
      80,
      [
        q({
          id: "ed_finalsweep", category: "detail", weight: 2, type: "multi",
          prompt:
            "The room looks spotless at a glance. On a proper final sweep, which of these are you actually checking? (select ALL that truly matter)",
          options: [
            { id: "hair", label: "A single hair on the bathroom floor / in the shower" },
            { id: "underbed", label: "Under the bed and behind the bedside tables" },
            { id: "fingerprints", label: "Fingerprints/smudges on mirrors, glass and stainless steel" },
            { id: "remote", label: "TV remote present and working, set to the home screen" },
            { id: "repaint", label: "Repainting any scuffed walls yourself" },
            { id: "smell", label: "First impression smell when you open the door" },
          ],
          correct: ["hair", "underbed", "fingerprints", "remote", "smell"],
          explanation: "Repainting isn't a cleaner's job — flag it. Everything else is a guest-visible detail.",
        }),
        q({
          id: "ed_trap", category: "detail", weight: 2, type: "single",
          prompt:
            "You've finished and the kitchen sparkles. The previous guest ran the dishwasher but didn't empty it. The cycle is clean. Best move?",
          options: [
            { id: "a", label: "Leave it — the dishes are clean, not your job." },
            { id: "b", label: "Empty it, put everything away, and wipe the inside seal — the next guest must open it to an empty, ready kitchen." },
            { id: "c", label: "Run it again to be safe, then leave it full." },
          ],
          correct: "b",
          explanation: "A 'clean but full' dishwasher reads as 'not cleaned' to the next guest.",
        }),
        q({
          id: "ed_linen", category: "detail", type: "single",
          prompt: "Which is the giveaway that a bed was made in a hurry rather than to standard?",
          options: [
            { id: "a", label: "Pillowcase openings face the wall and corners are tucked tight" },
            { id: "b", label: "A faint crease down the duvet and the top sheet untucked on one side" },
            { id: "c", label: "Decorative cushions arranged symmetrically" },
          ],
          correct: "b",
        }),
        q({
          id: "ed_photo", category: "detail", type: "short",
          prompt:
            "You photograph the lounge as 'done'. Name TWO things you'd zoom in on in your own photos to prove the detail is there.",
          placeholder: "e.g. ...",
        }),
      ]
    ),
  },
  {
    name: "Snap Decisions Under Pressure",
    description: "Instantaneous decision-making with a ticking clock and no one to ask.",
    schema: schema(
      "Snap Decisions Under Pressure",
      "There's no perfect answer to some of these — we're looking at how you decide when seconds count.",
      75,
      [
        q({
          id: "sd_late", category: "decisioning", weight: 2, type: "single",
          prompt:
            "It's 2:30pm, check-in is 3:00pm, and you're only halfway done because the place was trashed. You can't reach the office. What do you do FIRST?",
          options: [
            { id: "a", label: "Keep cleaning top-to-bottom and hope you finish." },
            { id: "b", label: "Triage: make the guest-critical areas (bed, bathroom, kitchen, smell) perfect first, then message the office the moment you can with an ETA." },
            { id: "c", label: "Leave and come back after the guest checks in." },
          ],
          correct: "b",
          explanation: "Protect the guest's first impression, then communicate — don't go silent.",
        }),
        q({
          id: "sd_locked", category: "adaptability", weight: 2, type: "single",
          prompt: "The lockbox code doesn't work and the office isn't answering. Best immediate move?",
          options: [
            { id: "a", label: "Force a window or try the back door." },
            { id: "b", label: "Try the code twice more carefully, photograph the lockbox, log the issue, and escalate through every approved channel — never improvise entry." },
            { id: "c", label: "Wait in the car indefinitely without telling anyone." },
          ],
          correct: "b",
        }),
        q({
          id: "sd_choose", category: "decisioning", type: "multi",
          prompt:
            "You have 15 minutes left and three things undone: (1) mop floors, (2) restock toilet paper & towels, (3) re-stage the decorative cushions. Which do you prioritise? (select the TWO that matter most)",
          options: [
            { id: "floors", label: "Mop the floors" },
            { id: "restock", label: "Restock toilet paper & towels" },
            { id: "cushions", label: "Re-stage the decorative cushions" },
          ],
          correct: ["floors", "restock"],
          explanation: "Function over styling under time pressure — a guest can forgive un-fluffed cushions, not missing toilet paper.",
        }),
        q({
          id: "sd_judgement", category: "decisioning", type: "short",
          prompt:
            "Describe a time you had to make a fast call with incomplete information. What did you decide and why? (2–3 sentences)",
          placeholder: "Your answer",
        }),
      ]
    ),
  },
  {
    name: "The Unexpected Situation",
    description: "How a candidate handles surprises — the guest still there, the flood, the thing that isn't in the checklist.",
    schema: schema(
      "The Unexpected Situation",
      "Real turnovers throw curveballs. Show us how you'd handle them.",
      75,
      [
        q({
          id: "us_guest", category: "scenario", weight: 2, type: "single",
          prompt: "You let yourself in to clean and a guest is still there, asleep. What do you do?",
          options: [
            { id: "a", label: "Start cleaning quietly around them." },
            { id: "b", label: "Step out immediately, don't disturb them, and contact the office to confirm the booking/checkout before re-entering." },
            { id: "c", label: "Wake them and tell them to leave." },
          ],
          correct: "b",
          explanation: "Wrong-booking or late-checkout — never confront; verify through the office.",
        }),
        q({
          id: "us_leak", category: "scenario", weight: 2, type: "single",
          prompt: "You find water pooling under the sink and the cabinet is soaked. Next guest arrives in 2 hours.",
          options: [
            { id: "a", label: "Mop it up and say nothing — it might dry out." },
            { id: "b", label: "Stop the source if it's safe (turn off the tap/valve), photograph it, report it urgently with the photos, and keep working the rest." },
            { id: "c", label: "Cancel the clean and go home." },
          ],
          correct: "b",
        }),
        q({
          id: "us_extra", category: "scenario", type: "single",
          prompt:
            "The property is FAR dirtier than a normal turnover (party aftermath). It'll take double the time. What's correct?",
          options: [
            { id: "a", label: "Rush it in the normal time and accept a lower standard." },
            { id: "b", label: "Photograph the condition BEFORE you start, submit an extra-pay request with the photos, and clean to standard." },
            { id: "c", label: "Refuse and leave without telling anyone." },
          ],
          correct: "b",
        }),
        q({
          id: "us_open", category: "adaptability", type: "short",
          prompt:
            "Tell us about the most unexpected thing you've faced on a job (any job) and exactly how you handled it.",
          placeholder: "Your answer",
        }),
      ]
    ),
  },
  {
    name: "Guest Experience & Hosting Sense",
    description: "Does the candidate think like a host? Reading the guest, the touches, the boundaries.",
    schema: schema(
      "Guest Experience & Hosting Sense",
      "Cleaning is half the job — the other half is hosting sense. There are some judgement calls here.",
      75,
      [
        q({
          id: "gx_contact", category: "guest", weight: 2, type: "single",
          prompt: "A guest messages YOU directly asking for an early check-in. What do you do?",
          options: [
            { id: "a", label: "Tell them yes to be helpful." },
            { id: "b", label: "Don't commit — politely say you'll pass it to the office, then relay it through the approved channel and keep working." },
            { id: "c", label: "Ignore the message completely." },
          ],
          correct: "b",
          explanation: "Never make booking promises to guests directly, but never go cold either.",
        }),
        q({
          id: "gx_touches", category: "guest", weight: 2, type: "multi",
          prompt:
            "Which small, low-cost touches genuinely lift a guest's first impression? (select all that are appropriate)",
          options: [
            { id: "smell", label: "A clean, neutral smell (not overpowering air freshener)" },
            { id: "fold", label: "Towels folded neatly / a tidy 'reset' presentation" },
            { id: "essentials", label: "Toilet paper, soap and basics clearly stocked and visible" },
            { id: "gift", label: "Buying the guest an expensive gift out of your own pocket" },
            { id: "lights", label: "Curtains opened and lights/heating left sensible for arrival (per host instructions)" },
          ],
          correct: ["smell", "fold", "essentials", "lights"],
          explanation: "Thoughtful resets — yes. Spending your own money on gifts — no.",
        }),
        q({
          id: "gx_complaint", category: "guest", type: "single",
          prompt: "A guest is in the driveway, visibly annoyed, saying the last stay was dirty. You're just there to clean. Best response?",
          options: [
            { id: "a", label: "Argue that it wasn't your fault." },
            { id: "b", label: "Stay calm and polite, don't take blame or make promises, assure them it's being cleaned to standard now, and report the interaction to the office." },
            { id: "c", label: "Offer them a refund on the spot." },
          ],
          correct: "b",
        }),
        q({
          id: "gx_creative", category: "creativity", type: "short",
          prompt:
            "Without spending money, what's ONE creative touch you'd add to a finished property to make a guest smile? Explain why it works.",
          placeholder: "Your answer",
        }),
      ]
    ),
  },
  {
    name: "Creative Problem-Solving",
    description: "Resourcefulness and creativity — making it work with what's on hand, and improving the system.",
    schema: schema(
      "Creative Problem-Solving",
      "Mostly open questions — we want to see how you think, not just what you know.",
      65,
      [
        q({
          id: "cp_nosupply", category: "creativity", weight: 2, type: "single",
          prompt:
            "You've run out of the proper glass cleaner and there's a smeary mirror. The supply cupboard only has dish soap, vinegar and microfibre cloths. Best approach?",
          options: [
            { id: "a", label: "Leave the mirror smeared — no proper product." },
            { id: "b", label: "Improvise safely with a little diluted vinegar + water on a microfibre, buff dry, then flag that stock needs reordering." },
            { id: "c", label: "Use a paper towel and the dish soap straight, leaving streaks." },
          ],
          correct: "b",
          explanation: "Resourceful AND reports the stock gap — both matter.",
        }),
        q({
          id: "cp_improve", category: "creativity", type: "short",
          prompt:
            "If you could change ONE thing about how a typical turnover is done to make it faster OR better, what would it be?",
          placeholder: "Your answer",
        }),
        q({
          id: "cp_layout", category: "creativity", type: "short",
          prompt:
            "A studio apartment always feels cramped to guests in photos. With no budget, how would you stage it to feel bigger and more inviting?",
          placeholder: "Your answer",
        }),
        q({
          id: "cp_eye", category: "detail", type: "single",
          prompt: "Creativity without standards is a problem. When does 'creative staging' cross a line?",
          options: [
            { id: "a", label: "When it changes the host's required layout/items or hides a real issue instead of reporting it." },
            { id: "b", label: "Whenever you move a single cushion." },
            { id: "c", label: "It never crosses a line — do whatever looks good." },
          ],
          correct: "a",
        }),
      ]
    ),
  },
];

/** Upsert the default quiz templates (by name) — never overwrites edits. */
export async function ensureDefaultQuizTemplates(): Promise<void> {
  for (const tpl of DEFAULT_QUIZ_TEMPLATES) {
    const existing = await db.quizTemplate.findFirst({ where: { name: tpl.name }, select: { id: true } });
    if (existing) continue;
    await db.quizTemplate.create({
      data: { name: tpl.name, description: tpl.description, schema: tpl.schema as any, isActive: true },
    });
  }
}

export async function listQuizTemplates() {
  return db.quizTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

/** Assign a quiz to a candidate, email them the take-it link, log the timeline. */
export async function assignQuizToApplication(input: { applicationId: string; quizTemplateId: string; actorId: string }) {
  const [application, template] = await Promise.all([
    db.hiringApplication.findUnique({ where: { id: input.applicationId }, include: { position: { select: { title: true } } } }),
    db.quizTemplate.findUnique({ where: { id: input.quizTemplateId } }),
  ]);
  if (!application) throw new Error("Application not found.");
  if (!template) throw new Error("Quiz not found.");

  const token = randomBytes(20).toString("hex");
  const assignment = await db.quizAssignment.create({
    data: { applicationId: application.id, quizTemplateId: template.id, token, status: "PENDING", sentAt: new Date() },
  });

  const link = `${appBaseUrl()}/quiz/${token}`;
  await sendEmail({
    to: application.email,
    subject: `Quick knowledge check — ${application.position?.title || "your application"}`,
    html: `<p>Hi ${application.fullName || "there"},</p><p>Thanks for applying! As the next step, please complete this short knowledge check — it takes just a few minutes.</p><p><a href="${link}" style="display:inline-block;background:#0f5a44;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">Start the quiz</a></p><p>Or paste this link into your browser: ${link}</p>`,
    transactional: true,
  });

  await logHiringEvent({
    applicationId: application.id,
    type: "ASSESSMENT",
    actorId: input.actorId,
    summary: `Quiz assigned & emailed: ${template.name}`,
    data: { quizTemplateId: template.id, assignmentId: assignment.id },
  });

  return assignment;
}

/** Public: load an assignment by token with the quiz questions (answers stripped). */
export async function getQuizForToken(token: string) {
  const assignment = await db.quizAssignment.findUnique({ where: { token }, include: { quizTemplate: true } });
  if (!assignment) return null;
  const schemaObj = assignment.quizTemplate.schema as unknown as AssessmentSchema;
  const publicQuestions = (schemaObj.questions ?? []).map((qq) => ({
    id: qq.id,
    prompt: qq.prompt,
    type: qq.type,
    category: qq.category,
    options: qq.options,
    placeholder: qq.placeholder,
  }));
  return {
    token: assignment.token,
    status: assignment.status,
    title: schemaObj.title,
    intro: schemaObj.intro,
    questions: publicQuestions,
  };
}

/** Public: submit answers, auto-score, record on the assignment + timeline. */
export async function submitQuizForToken(token: string, answers: Record<string, unknown>) {
  const assignment = await db.quizAssignment.findUnique({ where: { token }, include: { quizTemplate: true, application: true } });
  if (!assignment) throw new Error("Quiz not found.");
  if (assignment.status === "COMPLETED") return { alreadyDone: true };

  const schemaObj = assignment.quizTemplate.schema as unknown as AssessmentSchema;
  const result = scoreAssessment(schemaObj, answers);

  await db.quizAssignment.update({
    where: { id: assignment.id },
    data: { status: "COMPLETED", score: result.score, result: result as any, answers: answers as any, completedAt: new Date() },
  });

  await logHiringEvent({
    applicationId: assignment.applicationId,
    type: "ASSESSMENT",
    summary: `Quiz completed: ${assignment.quizTemplate.name} — ${Math.round(result.score)}%${result.passed ? " (passed)" : ""}`,
    data: { quizTemplateId: assignment.quizTemplateId, score: result.score, passed: result.passed },
  });

  return { ok: true, score: result.score, passed: result.passed };
}
