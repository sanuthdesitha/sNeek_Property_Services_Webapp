import React from "react";
import { createRoot } from "react-dom/client";
import { StageWrapup } from "@/components/v2/cleaner/job-stages/stage-wrapup";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";
function Fixture() {
  const [count, setCount] = React.useState("");
  const [recorded, setRecorded] = React.useState(false);
  const api = { locked: false, status: "IN_PROGRESS", laundryEnabled: true, schema: null, answers: {}, uploads: {}, property: {}, jobTasks: [], taskDrafts: {}, allTasksDecided: true,
    busy: null, addressLine: "Synthetic property", jobId: "fixture", carryHasNew: false, finalCheckupItems: [], bulkPool: [], laundryPhoto: [], carryPhotos: [], carryNotes: [],
    laundryOutcome: "READY_FOR_PICKUP", laundryBagLocation: "Shelf", laundryBagLocationOptions: [], laundryBagCount: count, setLaundryBagCount: setCount, laundryBagCountRecorded: recorded,
    setLaundryOutcome() {}, setLaundryBagLocation() {}, setLaundryPhoto() {}, requestSubmit() {}, setActiveStage() {},
  } as unknown as WorkspaceApi;
  return <><button onClick={() => { setCount("2"); setRecorded(true); }}>Load recorded confirmation fixture</button><StageWrapup api={api} /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
