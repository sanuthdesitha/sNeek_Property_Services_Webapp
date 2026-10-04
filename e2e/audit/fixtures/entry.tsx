import React from "react";
import { createRoot } from "react-dom/client";
import { PropertyJobsHistory } from "@/components/v2/admin/properties/property-jobs-history";
import { FormsQaCentre } from "@/components/v2/admin/jobs/forms-qa-centre";
import { TaskEvidence } from "@/components/v2/admin/jobs/task-evidence";
import { InvoiceCadenceSettings } from "@/components/v2/admin/finance/invoice-cadence";
import { PropertyCadenceLedger } from "@/components/v2/admin/properties/property-cadence-ledger";
const screen = new URLSearchParams(location.search).get("screen");
createRoot(document.getElementById("root")!).render(
  screen === "cadence" ? <InvoiceCadenceSettings /> :
  screen === "ledger" ? <PropertyCadenceLedger propertyId="property-test" /> :
  screen === "forms" ? <FormsQaCentre jobId="job-test" hasReport={false} hasQaReview={false} /> :
  screen === "tasks" ? <TaskEvidence jobId="job-test" includeInReport={true} tasks={[{ id: "task", title: "Window proof", executionStatus: "COMPLETED", proof: [{ id: "proof", mediaType: "PHOTO", url: "/proof.png", kind: "COMPLETION_PROOF" }] } as any]} /> :
  <PropertyJobsHistory propertyId="property-test" />
);
