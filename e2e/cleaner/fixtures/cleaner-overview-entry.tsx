import React from "react";
import { createRoot } from "react-dom/client";
import { JobHeader } from "@/components/v2/cleaner/job-stages/job-header";
import { StageAccept } from "@/components/v2/cleaner/job-stages/stage-accept";
import { StageTravel } from "@/components/v2/cleaner/job-stages/stage-travel";
import { StageSetup } from "@/components/v2/cleaner/job-stages/stage-setup";
import { ShiftRouteOverview } from "@/components/v2/cleaner/shift-route-overview";
import { DailyBriefing } from "@/components/v2/cleaner/daily-briefing";
function Fixture() {
  const [stage, setStage] = React.useState(1);
  const api: any = {
    propertyCode: "JacksonP1",
    addressLine: "1 Example Street, Sydney NSW",
    navUrl: "https://maps.google.com",
    status: "ASSIGNED",
    job: {
      id: "job",
      propertyId: "property",
      jobType: "AIRBNB_TURNOVER",
      scheduledDate: "2026-10-09T00:00:00Z",
      startTime: "09:00",
    },
    property: { name: "JacksonP1" },
    payload: {
      job: { id: "job" },
      previousLaundryCycle: {
        taskId: "laundry",
        status: "DROPPED",
        dropoffDate: "2026-10-08",
        droppedAt: "2026-10-08T05:00:00Z",
        prevCleanDate: "2026-10-07",
      },
    },
    timeState: { isRunning: false, completedSeconds: 0 },
    openContactSheet: () => {},
    openInfoDrawer: () => {},
    setActiveStage: setStage,
    readFirstItems: [],
    importantRequests: [],
    needsAcceptance: false,
    expectedDurationMinutes: 90,
    formatDurationMinutes: () => "1h 30m",
    laundryEnabled: true,
    bagLabel: "P1",
    bagColor: "green",
    restockNeeds: [],
    recurringIssues: [],
    startGateBlocks: false,
    locked: false,
    hasCheckin: false,
    busy: null,
    clockInDisabled: false,
    clockIn: () => {},
    pauseClock: () => {},
    setupGuideEntries: [
      {
        id: "reference",
        label: "Living room",
        instructions: "Match the property setup",
        images: [],
      },
    ],
    briefing: {
      previousLaundryDrop: { notes: "Outdated duplicate linen note" },
      jobNotes: "Check the balcony before leaving",
    },
  };
  return (
    <div
      data-skin="estate"
      data-portal-accent="cleaner"
      style={{ fontFamily: "Arial,sans-serif" }}
      className="estate-root min-h-screen bg-[hsl(var(--e-background))] p-4 text-[hsl(var(--e-foreground))]"
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="e-display-sm">Your day</h1>
        <ShiftRouteOverview
          userId="cleaner"
          day="2026-10-09"
          stops={[
            {
              jobId: "job",
              property: "JacksonP1",
              address: "1 Example Street",
              status: "ASSIGNED",
              startTime: "09:00",
            },
          ]}
        />
        <DailyBriefing />
        <JobHeader api={api} />
        <nav aria-label="Fixture steps">
          {[1, 2, 3].map((step) => (
            <button
              key={step}
              className="min-h-11 px-4"
              onClick={() => setStage(step)}
            >
              Step {step}
            </button>
          ))}
        </nav>
        {stage === 1 ? (
          <StageAccept api={api} />
        ) : stage === 2 ? (
          <StageTravel api={api} />
        ) : (
          <StageSetup api={api} />
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
