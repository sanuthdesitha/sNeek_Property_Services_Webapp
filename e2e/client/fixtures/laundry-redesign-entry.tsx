import React from "react";
import { createRoot } from "react-dom/client";
import { LaundryWorkspace } from "@/components/v2/client/laundry/laundry-workspace";
const tasks = (window as any).__laundryTasks;
createRoot(document.getElementById("root")!).render(<div data-skin="estate" data-portal-accent="client" className="min-h-screen"><main className="mx-auto min-w-0 max-w-6xl p-3 sm:p-6"><LaundryWorkspace tasks={tasks} showLaundryImages={false} properties={[{ id: "other", name: "Other property" }]} /></main></div>);
