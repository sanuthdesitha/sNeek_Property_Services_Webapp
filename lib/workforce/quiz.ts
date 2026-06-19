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
