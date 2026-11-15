"use client";

/**
 * The cleaner's practice job, offer to submit (board "Phone tours", 4 to 8).
 *
 * The REAL job stage components (Accept, Get there, Set up, Clean, Wrap up and
 * the submitted summary) render a sample job, "Practice: Demo Cottage". The
 * workspace API they receive is built here from local state only: accepting,
 * clocking in and submitting change this screen and nothing else. No location
 * is requested, the form runs in sandbox mode (no camera, no uploads, no
 * evidence) and any request a component still tries to send is stopped by the
 * practice guard (PracticeBoundary). A sample receipt is labelled Practice.
 */
import * as React from "react";
import { EAlert } from "@/components/v2/ui/primitives";
import { JobHeader } from "@/components/v2/cleaner/job-stages/job-header";
import { StageNav } from "@/components/v2/cleaner/job-stages/stage-nav";
import { StageAccept } from "@/components/v2/cleaner/job-stages/stage-accept";
import { StageTravel } from "@/components/v2/cleaner/job-stages/stage-travel";
import { StageSetup } from "@/components/v2/cleaner/job-stages/stage-setup";
import { StageClean } from "@/components/v2/cleaner/job-stages/stage-clean";
import { StageWrapup } from "@/components/v2/cleaner/job-stages/stage-wrapup";
import { StageFooterNav } from "@/components/v2/cleaner/job-stages/stage-footer";
import type { LaundryOutcome, TaskDraft, WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";
import type { AnswerMap, UploadMap } from "@/components/v2/cleaner/form-renderer";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";
import type { FormSchema } from "@/lib/forms/types";
import type { JobStage } from "@/lib/cleaner/job-stage";
import { PRACTICE_CLIENT, PRACTICE_PROPERTY } from "@/lib/tutorials/practice-samples";
import { useActiveTourStep } from "@/components/v2/tutorials/tutorial-provider";

export const PRACTICE_JOB_ID = "practice-job";
const TOUR_KEY = "cleaner.job.practice";

/** The practice step's screen: which stage shows and how far the sample job has got. */
type PracticeState = { stage: JobStage; accepted: boolean; started: boolean; submitted: boolean };

const STATE_FOR_STEP: Record<string, PracticeState> = {
  accept: { stage: 1, accepted: false, started: false, submitted: false },
  travel: { stage: 2, accepted: true, started: false, submitted: false },
  setup: { stage: 3, accepted: true, started: false, submitted: false },
  clean: { stage: 4, accepted: true, started: true, submitted: false },
  wrapup: { stage: 5, accepted: true, started: true, submitted: false },
  submitted: { stage: 5, accepted: true, started: true, submitted: true },
};

const PRACTICE_SCHEMA: FormSchema = {
  sections: [
    {
      id: "practice-bathroom",
      title: "Bathroom",
      fields: [
        { id: "practice-toilet", type: "checkbox", label: "Toilet cleaned inside and out", options: ["Done"] },
        { id: "practice-shower", type: "checkbox", label: "Shower glass streak-free", options: ["Done"] },
        { id: "practice-photo", type: "photo", label: "Bathroom photo (1 to 3)", helpText: "Example: whole room from the door, lights on.", minPhotos: 1, maxFiles: 3 },
      ],
    },
  ],
  standardSections: false,
} as FormSchema;

/** A pretend photo: sandbox media is never uploaded and has no file behind it. */
const PRACTICE_PHOTO: CapturedMedia = { key: "practice-photo-1", url: "", kind: "image", name: "Practice photo" };

const PRACTICE_TASKS = [
  { id: "practice-task-bin", title: "Bin emptied, liner in", source: "PRACTICE" },
  { id: "practice-task-towels", title: "Towels: 2 bath, 2 hand", source: "PRACTICE" },
];

function practiceJob() {
  const day = new Date();
  day.setHours(13, 0, 0, 0);
  return {
    id: PRACTICE_JOB_ID,
    jobNumber: "J-P061",
    propertyId: PRACTICE_PROPERTY.id,
    scheduledDate: day.toISOString(),
    startTime: "13:00",
    dueTime: "16:00",
    status: "OFFERED",
    jobType: "DEEP_CLEAN",
    updatedAt: day.toISOString(),
    property: { id: PRACTICE_PROPERTY.id, name: PRACTICE_PROPERTY.name, suburb: PRACTICE_PROPERTY.suburb, address: PRACTICE_PROPERTY.address },
    client: { name: PRACTICE_CLIENT.name },
  };
}

export function PracticeJob() {
  const step = useActiveTourStep(TOUR_KEY);
  const [state, setState] = React.useState<PracticeState>(STATE_FOR_STEP.accept);
  const [answers, setAnswers] = React.useState<AnswerMap>({});
  const [uploads, setUploads] = React.useState<UploadMap>({});
  const [taskDrafts, setTaskDrafts] = React.useState<Record<string, TaskDraft>>({});
  const [laundryOutcome, setLaundryOutcome] = React.useState<LaundryOutcome | "">("");
  const [laundryBagLocation, setLaundryBagLocation] = React.useState("");
  const [laundryBagCount, setLaundryBagCount] = React.useState("");
  const [laundryPhoto, setLaundryPhoto] = React.useState<CapturedMedia[]>([]);
  const [laundrySkipCode, setLaundrySkipCode] = React.useState("");
  const [laundrySkipNote, setLaundrySkipNote] = React.useState("");
  const [carryHasNew, setCarryHasNew] = React.useState(false);
  const [carryNotes, setCarryNotes] = React.useState<string[]>([]);
  const [carryPhotos, setCarryPhotos] = React.useState<CapturedMedia[]>([]);
  const [bulkPool, setBulkPool] = React.useState<CapturedMedia[]>([]);
  const [notice, setNotice] = React.useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [propertyCodeConfirmed, setPropertyCodeConfirmed] = React.useState(true);
  const job = React.useMemo(practiceJob, []);

  // The walkthrough moves the screen to the stage its step explains (on every step,
  // so a check-in clicked during "Check in" is undone for "No location fix?").
  const practiceState = step?.practiceState;
  const stepId = step?.id;
  React.useEffect(() => {
    if (!practiceState || !STATE_FOR_STEP[practiceState]) return;
    setState(STATE_FOR_STEP[practiceState]);
    // Wrap up shows a finished sample job, so Submit is the step being taught.
    if (practiceState === "wrapup" || practiceState === "submitted") {
      setTaskDrafts((current) => {
        const next = { ...current };
        for (const task of PRACTICE_TASKS) if ((next[task.id]?.decision ?? "OPEN") === "OPEN") next[task.id] = { decision: "COMPLETED", note: "", proof: [] };
        return next;
      });
      setAnswers((current) => ({ "practice-toilet": ["Done"], "practice-shower": ["Done"], ...current }));
      setUploads((current) => (current["practice-photo"]?.length ? current : { ...current, "practice-photo": [PRACTICE_PHOTO] }));
    }
  }, [practiceState, stepId]);

  const flash = React.useCallback((tone: "success" | "danger" | "info", text: string) => setNotice({ tone, text }), []);

  const api: WorkspaceApi = {
    formMode: "sandbox",
    payload: { job, payForJob: 109.5, property: job.property, settings: {} },
    job: { ...job, status: state.submitted ? "SUBMITTED" : state.started ? "IN_PROGRESS" : state.accepted ? "ASSIGNED" : "OFFERED" },
    property: { ...job.property, inventoryEnabled: false },
    briefing: null,
    template: { name: "Practice deep clean" },
    schema: PRACTICE_SCHEMA,
    jobId: PRACTICE_JOB_ID,
    status: state.submitted ? "SUBMITTED" : state.started ? "IN_PROGRESS" : state.accepted ? "ASSIGNED" : "OFFERED",
    locked: state.submitted,
    needsAcceptance: !state.accepted,
    hasStarted: state.started,
    teamStarted: state.started,
    ownStarted: state.started,
    hasCheckin: state.started,
    propertyId: PRACTICE_PROPERTY.id,
    addressLine: `${PRACTICE_PROPERTY.address}, ${PRACTICE_PROPERTY.suburb} NSW`,
    propertyCode: "P01",
    navUrl: "",
    jobTypeLabel: "Deep clean",
    expectedDurationMinutes: 180,
    formatDurationMinutes: (minutes) => `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`,
    jobTasks: PRACTICE_TASKS,
    importantRequests: [],
    readFirstItems: [],
    contact: null,
    restockNeeds: [],
    recurringIssues: [],
    requiredChecklistTicksBlockSubmit: false,
    canUseNoPhoto: true,
    enforceExtendedRules: false,
    setupGuideEntries: [],
    laundryEnabled: false,
    bagLabel: "",
    bagColor: "",
    laundryBagLocationOptions: [],
    timeState: { isRunning: state.started && !state.submitted, completedSeconds: 0, activeStartedAt: null, maxAllowedTotalSeconds: null },
    busy: null,
    activeStage: state.stage,
    setActiveStage: (stage) => setState((current) => ({ ...current, stage })),
    startGateBlocks: false,
    startGateSatisfied: true,
    clockInDisabled: false,
    propertyCodeConfirmed,
    setPropertyCodeConfirmed,
    laundryBagConfirmRequired: false,
    laundryBagConfirmed: true,
    setLaundryBagConfirmed: () => undefined,
    answers,
    uploads,
    onAnswer: (fieldId, value) => setAnswers((current) => ({ ...current, [fieldId]: value })),
    onUpload: (fieldId, media) => setUploads((current) => ({ ...current, [fieldId]: media })),
    taskDrafts,
    setTask: (id, patch) =>
      setTaskDrafts((current) => {
        const previous: TaskDraft = current[id] ?? { decision: "OPEN", note: "", proof: [] };
        return { ...current, [id]: { ...previous, ...patch } };
      }),
    allTasksDecided: PRACTICE_TASKS.every((task) => (taskDrafts[task.id]?.decision ?? "OPEN") !== "OPEN"),
    bulkPool,
    setBulkPool,
    setUploads,
    bulkAssignOpen: false,
    openBulkAssign: () => flash("info", "Practice: bulk photo upload is not part of the practice job."),
    closeBulkAssign: () => undefined,
    laundryOutcome,
    setLaundryOutcome,
    laundryBagLocation,
    laundryBagCount,
    setLaundryBagCount,
    laundryBagCountRecorded: false,
    setLaundryBagLocation,
    laundryPhoto,
    setLaundryPhoto,
    laundrySkipCode,
    setLaundrySkipCode,
    laundrySkipNote,
    setLaundrySkipNote,
    laundryLocked: false,
    laundryAmendedSinceSend: false,
    beginLaundryEdit: () => undefined,
    laundryEarlySending: false,
    laundryEarlySentAt: null,
    laundryEarlyNotice: null,
    sendLaundryEarlyUpdate: () => flash("info", "Practice: nothing is sent to the laundry."),
    carryHasNew,
    setCarryHasNew,
    carryNotes,
    setCarryNotes,
    carryPhotos,
    setCarryPhotos,
    finalCheckupItems: [],
    timingRules: null,
    flash,
    clockIn: () => {
      setState((current) => ({ ...current, started: true, stage: 4 }));
      flash("info", "Practice: the clock did not start and no location was recorded.");
    },
    pauseClock: () => flash("info", "Practice: there is no real clock to pause."),
    clockOutEarly: () => flash("info", "Practice: there is no real clock to stop."),
    submit: () => submitPractice(),
    requestSubmit: () => submitPractice(),
    load: () => undefined,
    openInfoDrawer: () => flash("info", "Practice: Demo Cottage has no property guide."),
    openContactSheet: () => flash("info", "Practice: there is nobody to call for a practice job."),
  };

  function submitPractice() {
    setState((current) => ({ ...current, submitted: true }));
    flash("success", "Practice receipt P-0001 (a sample, marked Practice). Nothing was sent; on a real job, wait for the receipt number.");
  }

  return (
    <div className="space-y-5">
      <JobHeader api={api} />
      <StageNav api={api} />
      {notice ? (
        <EAlert tone={notice.tone === "danger" ? "danger" : notice.tone === "success" ? "success" : "info"}>
          <span role="status">{notice.text}</span>
        </EAlert>
      ) : null}
      <div>
        {state.stage === 1 ? <StageAccept api={api} /> : null}
        {state.stage === 2 ? <StageTravel api={api} /> : null}
        {state.stage === 3 ? <StageSetup api={api} /> : null}
        {state.stage === 4 ? <StageClean api={api} /> : null}
        {state.stage === 5 ? <StageWrapup api={api} /> : null}
        <StageFooterNav api={api} />
      </div>
    </div>
  );
}
