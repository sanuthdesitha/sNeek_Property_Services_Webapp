import { Role } from "@prisma/client";

export type LearningQuestion = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  options?: Array<{ id: string; label: string }>;
  correct?: string | string[];
  placeholder?: string;
  explanation?: string;
  category: string;
  weight?: number;
};

export type LearningModule = {
  id: string;
  kind: "lesson" | "quiz";
  title: string;
  summary?: string;
  imageUrl?: string;
  sections?: Array<{
    heading?: string;
    body?: string;
    bullets?: string[];
    callout?: string;
  }>;
  questions?: LearningQuestion[];
};

export type LearningSchema = {
  version: number;
  audienceRoles: Array<Role | string>;
  scoringModel: string;
  modules: LearningModule[];
};

export function buildCleanerAssessmentSchema(): LearningSchema {
  return {
    version: 1,
    audienceRoles: [Role.CLEANER],
    scoringModel: "weighted_operational_readiness",
    modules: [
      {
        id: "assessment-intro",
        kind: "lesson",
        title: "Read This Before You Start",
        summary: "This checks judgement, safety, detail, pace, and client care. It is not an IQ test.",
        imageUrl: "/workforce/onboarding-overview.svg",
        sections: [
          {
            heading: "What this assessment measures",
            bullets: [
              "Safety judgement around chemicals, access, and hazards.",
              "Turnover decision-making under time pressure.",
              "Client-care judgement when something is missing or damaged.",
              "Attention to detail when following standards and notes.",
              "How much coaching the cleaner is likely to need in the first month.",
            ],
          },
        ],
      },
      {
        id: "assessment-core",
        kind: "quiz",
        title: "Operational Readiness Assessment",
        summary: "Scenario-based questions based on real field judgement.",
        questions: [
          {
            id: "chemicals_1",
            prompt: "You find two spray bottles with no labels. One smells like bleach. What is the safest next step?",
            type: "single",
            options: [
              { id: "a", label: "Use both only on bathroom surfaces so nothing is wasted." },
              { id: "b", label: "Do not use them, isolate them, and ask for the correct labelled product." },
              { id: "c", label: "Mix them with water to make them less strong." },
              { id: "d", label: "Use a small amount and see what happens." },
            ],
            correct: "b",
            explanation: "Unlabelled chemicals should not be used. Safe Work guidance relies on correct labelling and SDS-driven handling.",
            category: "safety",
            weight: 3,
          },
          {
            id: "turnover_1",
            prompt: "A same-day check-in is due by 12:30 PM, but the late checkout guest has only left at 11:45 AM. What should happen first?",
            type: "single",
            options: [
              { id: "a", label: "Start deep-cleaning the rooms furthest from the guest without telling anyone." },
              { id: "b", label: "Immediately flag the late departure through the app/admin channel and re-plan priority tasks." },
              { id: "c", label: "Skip linen and restock so the clean can still finish fast." },
              { id: "d", label: "Mark the job done later if the property looks mostly fine." },
            ],
            correct: "b",
            category: "turnover",
            weight: 3,
          },
          {
            id: "client_1",
            prompt: "The client has left a specific note asking for extra attention to the oven and balcony glass. You are running late. What is the correct response?",
            type: "single",
            options: [
              { id: "a", label: "Skip both unless the client messages again." },
              { id: "b", label: "Complete the requested areas, document constraints clearly, and escalate if timing will be impacted." },
              { id: "c", label: "Finish the usual rooms and leave the note for the next cleaner." },
              { id: "d", label: "Tick those items complete to avoid questions." },
            ],
            correct: "b",
            category: "client-care",
            weight: 3,
          },
          {
            id: "airbnb_1",
            prompt: "For a non-same-day turnover with no incoming guest details, what guest count should the property be prepared for?",
            type: "single",
            options: [
              { id: "a", label: "Only the count from the guest who checked out." },
              { id: "b", label: "The property maximum guest count set on the property settings." },
              { id: "c", label: "Two guests by default." },
              { id: "d", label: "Whatever stock happens to be left on site." },
            ],
            correct: "b",
            category: "airbnb-readiness",
            weight: 2,
          },
          {
            id: "bed_1",
            prompt: "A fitted sheet looks clean but has a faint hair line near the pillow area. What is the best decision?",
            type: "single",
            options: [
              { id: "a", label: "Use it because most guests will not notice." },
              { id: "b", label: "Shake it and remake the bed quickly." },
              { id: "c", label: "Replace it because presentation standards must be guest-ready, not mostly clean." },
              { id: "d", label: "Put it underneath the doona where it will not be seen." },
            ],
            correct: "c",
            category: "detail",
            weight: 2,
          },
          {
            id: "inventory_1",
            prompt: "The property is out of toilet paper for tomorrow's guest, and there is no backup stock. What is the correct workflow?",
            type: "single",
            options: [
              { id: "a", label: "Leave it and mention it in your head only." },
              { id: "b", label: "Create the stock/shopping signal immediately so there is time to restock before the next arrival." },
              { id: "c", label: "Borrow stock from another nearby property without recording it." },
              { id: "d", label: "Ask the guest to buy their own." },
            ],
            correct: "b",
            category: "readiness",
            weight: 2,
          },
          {
            id: "conflict_1",
            prompt: "A guest messages aggressively about a stain before you have finished checking the room. What is the best response pattern?",
            type: "single",
            options: [
              { id: "a", label: "Argue with the guest because you are still on site." },
              { id: "b", label: "Acknowledge calmly, gather facts/evidence, and escalate through the proper admin/client flow." },
              { id: "c", label: "Ignore the message until tomorrow." },
              { id: "d", label: "Promise a refund immediately." },
            ],
            correct: "b",
            category: "client-care",
            weight: 3,
          },
          {
            id: "laundry_1",
            prompt: "Laundry is not ready yet, but the full job form is not finished. What should you do?",
            type: "single",
            options: [
              { id: "a", label: "Wait until the whole form is done and hope the laundry team guesses correctly." },
              { id: "b", label: "Send the laundry update early with the correct outcome and reason, then finish the rest later." },
              { id: "c", label: "Mark ready anyway so the schedule keeps moving." },
              { id: "d", label: "Do nothing unless admin calls." },
            ],
            correct: "b",
            category: "workflow",
            weight: 2,
          },
          {
            id: "security_1",
            prompt: "You arrive and the key is not where the access instructions said it would be. What is the correct first action?",
            type: "single",
            options: [
              { id: "a", label: "Try nearby windows or doors in case one was left open." },
              { id: "b", label: "Use another property's code if you know it works." },
              { id: "c", label: "Stop and escalate through the approved contact path; do not improvise entry." },
              { id: "d", label: "Leave and mark the job complete later." },
            ],
            correct: "c",
            category: "security",
            weight: 3,
          },
          {
            id: "scenario_1",
            prompt: "Select all actions that are correct when admin has added a special requested task to the job form.",
            type: "multi",
            options: [
              { id: "a", label: "Treat it as required work for that job." },
              { id: "b", label: "Skip it if you selected all standard tasks." },
              { id: "c", label: "Provide photo proof if the task requires it." },
              { id: "d", label: "Leave it blank if the rest of the form is complete." },
            ],
            correct: ["a", "c"],
            category: "workflow",
            weight: 2,
          },
          {
            id: "scenario_2",
            prompt: "A bathroom drain issue looks like damage rather than routine cleaning. What should happen in the system?",
            type: "single",
            options: [
              { id: "a", label: "Ignore it because maintenance is not cleaning." },
              { id: "b", label: "Create the damage/case evidence as part of the job submission so admin can track and respond." },
              { id: "c", label: "Text the client from your personal phone." },
              { id: "d", label: "Finish the job and say nothing unless the next guest complains." },
            ],
            correct: "b",
            category: "workflow",
            weight: 2,
          },
          {
            id: "scenario_3",
            prompt: "Short answer: what makes a property truly guest-ready, not just technically cleaned?",
            type: "short",
            placeholder: "Describe the standard in one or two sentences.",
            category: "detail",
            weight: 1,
          },
        ],
      },
    ],
  };
}

export function buildCleanerOnboardingSchema(): LearningSchema {
  return {
    version: 1,
    audienceRoles: [Role.CLEANER],
    scoringModel: "guided_course_with_checks",
    modules: [
      {
        id: "welcome",
        kind: "lesson",
        title: "Who We Are and What Good Looks Like",
        summary: "The company standard is reliable, guest-ready execution with clear reporting.",
        imageUrl: "/workforce/onboarding-overview.svg",
        sections: [
          {
            heading: "What the business does",
            bullets: [
              "Short-stay and scheduled cleaning operations across multiple property types.",
              "Laundry, stock readiness, reports, and client communication are part of the job outcome, not extras.",
              "The standard is consistency: safe, on-time, documented, and guest-ready.",
            ],
          },
          {
            heading: "What the system expects from cleaners",
            bullets: [
              "Start jobs properly, verify access, and keep the clock accurate.",
              "Use the job form to prove work, not just to submit a checklist.",
              "Escalate risk early: stock, damage, late departures, laundry, and access issues.",
            ],
          },
        ],
      },
      {
        id: "cleaning-types",
        kind: "lesson",
        title: "Cleaning Types and How They Differ",
        imageUrl: "/workforce/airbnb-turnover.svg",
        sections: [
          {
            heading: "Airbnb turnover",
            bullets: [
              "Fast reset between guests with strong focus on bed presentation, bathroom reset, kitchen finish, stock, and arrival readiness.",
              "Same-day check-ins change priority; early check-in and late checkout flags matter.",
            ],
          },
          {
            heading: "Deep cleaning or special cleans",
            bullets: [
              "Extra time is spent on build-up areas, detailing, appliances, and edge cases.",
              "Admin-requested tasks in the form are mandatory and must be evidenced if required.",
            ],
          },
          {
            heading: "Common failure modes",
            bullets: [
              "Rushing presentation areas.",
              "Missing stock signals.",
              "Submitting vague notes instead of concrete evidence.",
            ],
          },
        ],
      },
      {
        id: "app-workflow",
        kind: "lesson",
        title: "Using the App Properly",
        imageUrl: "/workforce/client-care.svg",
        sections: [
          {
            heading: "Basic sequence",
            bullets: [
              "Open the job, complete the start verification, then start the clock.",
              "Work through checklist, uploads, laundry, and submit steps in order.",
              "If laundry status is urgent, send the laundry update early; do not wait for the full form.",
            ],
          },
          {
            heading: "Clock discipline",
            bullets: [
              "Pause the clock when not actively working the job.",
              "If you forget, the system may auto-cap time; explain any adjustment honestly and clearly.",
            ],
          },
        ],
      },
      {
        id: "chemicals",
        kind: "lesson",
        title: "Chemical Safety and Surface Care",
        imageUrl: "/workforce/chemicals.svg",
        sections: [
          {
            heading: "Safe handling basics",
            bullets: [
              "Only use labelled products and follow the product instructions/SDS.",
              "Do not mix chemicals unless the manufacturer specifically allows it.",
              "Ventilate spaces where needed and use the right PPE for the product/task.",
            ],
            callout: "This course aligns with the same practical principles used in Safe Work guidance and standard disinfectant instructions: correct product, correct surface, correct contact time.",
          },
          {
            heading: "Practical cleaning judgement",
            bullets: [
              "Use the correct product for the surface to avoid damage.",
              "Heavily soiled areas may need dwell time before wiping.",
              "If in doubt, pause and escalate rather than damage a client asset.",
            ],
          },
        ],
      },
      {
        id: "beds-and-presentation",
        kind: "lesson",
        title: "Beds, Linen, and Guest Presentation",
        imageUrl: "/workforce/bed-standard.svg",
        sections: [
          {
            heading: "Bed standard",
            bullets: [
              "Fresh, aligned, visibly clean, and photo-ready.",
              "Pillow presentation and crease reduction matter because guests judge cleanliness visually.",
              "If linen quality is uncertain, replace it.",
            ],
          },
          {
            heading: "Laundry handoff",
            bullets: [
              "Use the right laundry outcome and reason.",
              "Bag location and photo proof are mandatory when ready for pickup.",
            ],
          },
        ],
      },
      {
        id: "airbnb-and-restock",
        kind: "lesson",
        title: "Airbnb Basics and Restock Discipline",
        imageUrl: "/workforce/airbnb-turnover.svg",
        sections: [
          {
            heading: "What Airbnb means operationally",
            bullets: [
              "Guests arrive expecting hotel-like readiness with home-level details.",
              "Turnover timing, check-in instructions, linen readiness, and consumables directly affect ratings.",
            ],
          },
          {
            heading: "Restock mindset",
            bullets: [
              "Prepare for the incoming guest, not the guest who just left.",
              "If no same-day incoming booking exists, use the property's max guest count as the prep standard.",
              "Record missing or critical stock early enough for admin to solve it before arrival.",
            ],
          },
        ],
      },
      {
        id: "difficult-situations",
        kind: "lesson",
        title: "Handling Difficult Situations Professionally",
        imageUrl: "/workforce/client-care.svg",
        sections: [
          {
            heading: "Guests or clients under stress",
            bullets: [
              "Stay factual and calm.",
              "Do not promise refunds or outcomes outside your authority.",
              "Use the system to record evidence and escalate with clarity.",
            ],
          },
          {
            heading: "When to escalate immediately",
            bullets: [
              "Damage, missing access, safety hazards, major stock shortages, and same-day timing risks.",
            ],
          },
        ],
      },
      {
        id: "onboarding-check",
        kind: "quiz",
        title: "Knowledge Check",
        questions: [
          {
            id: "course_q1",
            prompt: "Which statement is correct about admin-requested special tasks?",
            type: "single",
            options: [
              { id: "a", label: "They are optional if the property looks fine." },
              { id: "b", label: "They are required and may need specific image proof." },
              { id: "c", label: "They can be skipped by selecting all standard tasks." },
            ],
            correct: "b",
            category: "workflow",
            weight: 2,
          },
          {
            id: "course_q2",
            prompt: "What should happen if you find critical stock missing for tomorrow's guest?",
            type: "single",
            options: [
              { id: "a", label: "Leave it for the next cleaner." },
              { id: "b", label: "Create the inventory/shopping signal immediately so there is time to fix it." },
              { id: "c", label: "Hide the shortage in the report." },
            ],
            correct: "b",
            category: "readiness",
            weight: 2,
          },
          {
            id: "course_q3",
            prompt: "Choose all correct statements about clock use.",
            type: "multi",
            options: [
              { id: "a", label: "Pause when you stop active work on the job." },
              { id: "b", label: "If you forget, explain the adjustment honestly when submitting." },
              { id: "c", label: "Leave it running because admin can guess the real hours later." },
            ],
            correct: ["a", "b"],
            category: "workflow",
            weight: 2,
          },
          {
            id: "course_q4",
            prompt: "Short answer: what should you do if a guest or client is upset and you do not yet know the full facts?",
            type: "short",
            placeholder: "Explain the professional response.",
            category: "client-care",
            weight: 1,
          },
        ],
      },
    ],
  };
}

export function buildDefaultHiringSchema() {
  return {
    version: 1,
    steps: [
      {
        id: "contact",
        title: "Your Details",
        fields: [
          { id: "fullName", label: "Full name", type: "text", required: true },
          { id: "email", label: "Email", type: "email", required: true },
          { id: "phone", label: "Mobile number", type: "phone", required: true },
          { id: "location", label: "Base suburb / area", type: "text", required: true },
        ],
      },
      {
        id: "availability",
        title: "Availability and Mobility",
        fields: [
          {
            id: "availabilityDays",
            label: "Which days can you usually work?",
            type: "multi",
            required: true,
            options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
          },
          {
            id: "hasVehicle",
            label: "Do you have reliable transport?",
            type: "single",
            required: true,
            options: ["Own vehicle", "Public transport only", "Depends on location"],
          },
          {
            id: "licenseStatus",
            label: "Driver licence status",
            type: "single",
            required: true,
            options: ["Full licence", "Provisional licence", "No licence"],
          },
        ],
      },
      {
        id: "experience",
        title: "Experience and Standards",
        fields: [
          {
            id: "cleaningExperience",
            label: "How much cleaning experience do you have?",
            type: "single",
            required: true,
            options: ["No formal experience", "Less than 1 year", "1-3 years", "3+ years"],
          },
          {
            id: "propertyTypes",
            label: "Which work have you handled before?",
            type: "multi",
            required: true,
            options: ["Airbnb / short-stay", "Residential", "Commercial", "Deep cleans", "Laundry / linen"],
          },
          {
            id: "bedPresentation",
            label: "How confident are you making guest-ready beds to a hotel-style standard?",
            type: "single",
            required: true,
            options: ["Not confident", "Somewhat confident", "Confident", "Very confident"],
          },
        ],
      },
      {
        id: "scenario",
        title: "Scenario Questions",
        fields: [
          {
            id: "scenarioLateGuest",
            label: "A same-day check-in is coming, but the checkout guest is still in the property. What do you do?",
            type: "longText",
            required: true,
          },
          {
            id: "scenarioMissingStock",
            label: "The property is low on essentials for tomorrow's guest. What is your process?",
            type: "longText",
            required: true,
          },
        ],
      },
      {
        id: "compliance",
        title: "Documents",
        fields: [
          { id: "resumeUrl", label: "Resume / CV", type: "file", required: true },
          { id: "rightToWork", label: "Do you have legal work rights in Australia?", type: "single", required: true, options: ["Yes", "No"] },
          { id: "policeCheck", label: "Police check status", type: "single", required: true, options: ["Current", "Expired", "Do not have one yet"] },
        ],
      },
    ],
  };
}

export function buildDefaultCleanerHiringDescription() {
  return [
    "We are hiring detail-focused cleaners who can work independently, communicate clearly, and prepare guest-ready properties to a high standard.",
    "The work includes short-stay turnovers, scheduled cleans, stock awareness, photo evidence, and app-based reporting.",
    "Strong judgement, reliability, and calm problem-solving matter more than saying the right thing in an interview.",
  ].join("\n\n");
}

