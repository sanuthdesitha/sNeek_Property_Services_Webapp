import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, ExternalLink, MessageSquare, RadioTower, Settings2, Star } from "lucide-react";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function formatWhen(value?: Date | string | null) {
  if (!value) return "-";
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export default async function ClientHubPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const client = await db.client.findUnique({
    where: { id: params.id },
    include: {
      notificationPref: true,
      automationRules: {
        include: {
          template: {
            select: { id: true, name: true, triggerType: true, channel: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      properties: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          suburb: true,
          jobs: {
            take: 12,
            orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              jobNumber: true,
              jobType: true,
              status: true,
              scheduledDate: true,
              startTime: true,
              enRouteStartedAt: true,
              createdAt: true,
              property: { select: { id: true, name: true, suburb: true } },
              assignments: {
                where: { removedAt: null },
                select: {
                  isPrimary: true,
                  user: { select: { id: true, name: true, phone: true } },
                },
              },
              feedback: {
                select: {
                  id: true,
                  rating: true,
                  comment: true,
                  submittedAt: true,
                  token: true,
                  tokenExpiresAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!client) notFound();

  const jobs = client.properties
    .flatMap((property) => property.jobs)
    .sort((a, b) => +new Date(b.scheduledDate) - +new Date(a.scheduledDate));

  const jobIds = jobs.map((job) => job.id);

  const notifications = jobIds.length
    ? await db.notification.findMany({
        where: { jobId: { in: jobIds } },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    : [];

  const enabledRules = client.automationRules.filter((rule) => rule.isEnabled);
  const latestFeedback = jobs
    .filter((job) => job.feedback)
    .map((job) => ({ job, feedback: job.feedback! }))
    .sort((a, b) => +new Date(b.feedback.submittedAt ?? b.job.createdAt) - +new Date(a.feedback.submittedAt ?? a.job.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/admin/clients/${client.id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">Client hub</h1>
          <p className="text-sm text-muted-foreground">
            Operations view for {client.name} — jobs, notifications, automations, and feedback in one place.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/admin/clients/${client.id}`}>
            Back to client detail
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Recent jobs</p>
            <p className="text-2xl font-semibold">{jobs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Notifications</p>
            <p className="text-2xl font-semibold">{notifications.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Automation rules enabled</p>
            <p className="text-2xl font-semibold">{enabledRules.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Feedback received</p>
            <p className="text-2xl font-semibold">{latestFeedback.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <RadioTower className="h-4 w-4" />
                  Job command stream
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recent client jobs with direct links for deeper debugging.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs found for this client yet.</p>
              ) : (
                jobs.map((job) => {
                  const primaryCleaner = job.assignments.find((assignment) => assignment.isPrimary)?.user ?? job.assignments[0]?.user;
                  return (
                    <div key={job.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {job.property?.name ?? "Property"}
                            {job.jobNumber ? <span className="text-xs text-muted-foreground"> · {job.jobNumber}</span> : null}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {prettify(job.jobType)} · {new Date(job.scheduledDate).toLocaleDateString()}
                            {job.startTime ? ` · ${job.startTime}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Status: {prettify(job.status)}
                            {job.enRouteStartedAt ? ` · en route ${formatWhen(job.enRouteStartedAt)}` : ""}
                            {primaryCleaner ? ` · ${primaryCleaner.name}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{prettify(job.status)}</Badge>
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/admin/jobs/${job.id}`}>
                              Open job
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Notification log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No job-related notifications recorded yet.</p>
              ) : (
                notifications.map((notification) => (
                  <div key={notification.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm">{notification.subject ?? prettify(notification.channel)}</p>
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {notification.channel} · {notification.status}
                          {notification.deliveryStatus ? ` · ${notification.deliveryStatus}` : ""}
                          {` · ${formatWhen(notification.createdAt)}`}
                        </p>
                      </div>
                      {notification.jobId ? (
                        <Button size="sm" variant="ghost" asChild>
                          <Link href={`/admin/jobs/${notification.jobId}`}>
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Job
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Automation summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>Client notifications</span>
                  <Badge variant={client.notificationPref?.notificationsEnabled === false ? "secondary" : "outline"}>
                    {client.notificationPref?.notificationsEnabled === false ? "Disabled" : "Enabled"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Channel: {client.notificationPref?.preferredChannel ?? "EMAIL"}
                </p>
              </div>

              {client.automationRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No automation rules configured yet.</p>
              ) : (
                client.automationRules.map((rule) => (
                  <div key={rule.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{prettify(rule.triggerType)}</p>
                      <Badge variant={rule.isEnabled ? "outline" : "secondary"}>
                        {rule.isEnabled ? "Enabled" : "Off"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rule.template?.name ?? "No template linked"} · {rule.channel} · delay {rule.delayMinutes} min
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="h-4 w-4" />
                Feedback queue
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {latestFeedback.length === 0 ? (
                <p className="text-sm text-muted-foreground">No feedback records yet.</p>
              ) : (
                latestFeedback.slice(0, 8).map(({ job, feedback }) => (
                  <div key={feedback.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{job.property?.name ?? "Property"}</p>
                      <Badge variant="outline">
                        {feedback.rating != null ? `${feedback.rating}/5` : "Pending"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {feedback.submittedAt ? `Submitted ${formatWhen(feedback.submittedAt)}` : `Token expires ${formatWhen(feedback.tokenExpiresAt)}`}
                    </p>
                    {feedback.comment ? (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{feedback.comment}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
