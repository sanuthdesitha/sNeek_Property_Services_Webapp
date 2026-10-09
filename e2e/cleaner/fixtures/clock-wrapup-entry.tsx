import React from "react";
import { createRoot } from "react-dom/client";
import { StageWrapup } from "@/components/v2/cleaner/job-stages/stage-wrapup";
function Fixture() {
 const [running, setRunning] = React.useState(false);
 const [submitted, setSubmitted] = React.useState(false);
 const api: any = { timeState: { isRunning: running, completedSeconds: 600 }, locked: false, status: "PAUSED", laundryEnabled: false, schema: null, answers: {}, uploads: {}, property: {}, jobTasks: [], taskDrafts: {}, allTasksDecided: true,
 busy: null, addressLine: "Test property", jobId: "job", carryHasNew: false, finalCheckupItems: [], bulkPool: [], laundryPhoto: [], carryPhotos: [], carryNotes: [], requestSubmit: () => setSubmitted(true), setActiveStage: () => {} };
 return <div data-skin="estate" data-portal-accent="cleaner" className="estate-root min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))] p-3"><button onClick={() => setRunning(!running)}>Toggle clock</button><StageWrapup api={api}/>{submitted && <p role="status">Form requested</p>}</div>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
