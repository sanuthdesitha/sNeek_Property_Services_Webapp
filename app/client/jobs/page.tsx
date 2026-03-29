import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { ClipboardList } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { getClientPortalContext } from "@/lib/client/portal";
import { listClientJobsForUser } from "@/lib/client/portal-data";
import { ensureClientModuleAccess } from "@/lib/portal-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientJobTaskRequestDialog } from "@/components/client/job-task-request-dialog";

const TZ = "Australia/Sydney";

function summarizeTaskRequests(tasks: Array<{ source: string; approvalStatus: string; executionStatus: string }>) {
  const relevant = tasks.filter((task) => task.source === "CLIENT" || task.source === "CARRY_FORWARD");
  return {
    pending: relevant.filter((task) => task.approvalStatus === "PENDING_APPROVAL").length,
    approved: relevant.filter((task) => ["APPROVED", "AUTO_APPROVED"].includes(task.approvalStatus)).length,
    unresolved: relevant.filter((task) => ["OPEN", "NOT_COMPLETED", "CARRIED_FORWARD"].includes(task.executionStatus)).length,
  };
}

export default async function ClientJobsPage() {
  await ensureClientModuleAccess("jobs");
  const session = await requireRole([Role.CLIENT]);
  const settings = await getAppSettings();
  const portal = await getClientPortalContext(session.user.id, settings);
  const jobs = await listClientJobsForUser(session.user.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Status-focused job view with task request tracking for each service.
        </p>
      </div>

      <div className="space-y-4">
        {jobs.map((job) => {
          const taskSummary = summarizeTaskRequests(job.jobTasks);
          return (
            <Card key={job.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                  <span className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10">
                      <ClipboardList className="h-4 w-4 text-primary" />
                    </span>
                    <span>
                      {job.jobNumber ? `Job ${job.jobNumber}` : "Job"} • {job.jobType.replace(/_/g, " ")}
                    </span>
                  </span>
                  <span className="rounded-full border px-2 py-1 text-xs font-medium">
                    {job.status.replace(/_/g, " ")}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Property</p>
                    <p className="font-medium">{job.property.name}</p>
                    <p className="text-xs text-muted-foreground">{job.property.suburb}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Scheduled</p>
                    <p className="font-medium">{format(toZonedTime(job.scheduledDate, TZ), "EEE dd MMM yyyy")}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.startTime || "Time not set"}
                      {job.dueTime ? ` - ${job.dueTime}` : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Assignment</p>
                    <p className="font-medium">{job.assignments.length > 0 ? "Assigned" : "Unassigned"}</p>
                    {portal.visibility.showCleanerNames && job.assignments.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {job.assignments.map((assignment) => assignment.user?.name || "Cleaner").join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Task requests</p>
                    <p className="font-medium">
                      {taskSummary.pending} pending • {taskSummary.approved} approved
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {taskSummary.unresolved} unresolved
                    </p>
                  </div>
                </div>

                {portal.visibility.showClientTaskRequests ? (
                  <div className="flex justify-end">
                    <ClientJobTaskRequestDialog
                      jobId={job.id}
                      jobLabel={`${job.property.name} • ${format(toZonedTime(job.scheduledDate, TZ), "dd MMM yyyy")}`}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}

        {jobs.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No jobs found for this client account.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
