import React from "react";
import { createRoot } from "react-dom/client";
import LaundryLayout from "@/app/v2/laundry/layout";
import { LaundryCalendar } from "@/components/v2/laundry/laundry-calendar";
import { HistoryBoard } from "@/components/v2/laundry/history-board";
import { InvoicesPanel } from "@/components/v2/laundry/invoices-panel";
import { QueueBoard, RunsBoard, TrackingBoard } from "@/components/v2/laundry/laundry-board";
import { NextStopExecution } from "@/components/v2/laundry/next-stop-execution";
import { LaundryActionModal, type LaundryAction } from "@/components/v2/laundry/laundry-action-modal";
function NextStop() {
  const [action, setAction] = React.useState<LaundryAction | null>(null);
  const task = { id: "stop", status: "CONFIRMED", pickupDate: new Date().toISOString(), dropoffDate: new Date().toISOString(), property: { name: "WatersideApartments".repeat(6), address: "LongStreetAddress".repeat(8) } };
  const config = { showPickupPhoto: true, requireDropoffPhoto: true, requireEarlyDropoffReason: true, showCostTracking: true };
  return <><NextStopExecution task={task} kind="pickup" config={config} onAction={(_, action) => setAction(action)} />{action ? <LaundryActionModal task={task} action={action} config={config} suppliers={[]} dropoffOptions={[]} onClose={() => setAction(null)} onDone={() => setAction(null)} /> : null}</>;
}
const screen = new URLSearchParams(location.search).get("screen");
createRoot(document.getElementById("root")!).render(<LaundryLayout>
  {screen === "next-stop" ? <NextStop /> : screen === "history" ? <HistoryBoard /> : screen === "invoices" ? <InvoicesPanel properties={[]} /> : screen === "queue" ? <QueueBoard /> : screen === "runs" ? <RunsBoard /> : screen === "tracking" ? <TrackingBoard /> : <LaundryCalendar />}
</LaundryLayout>);
