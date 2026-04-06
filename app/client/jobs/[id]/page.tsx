"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Download,
  FileText,
  Loader2,
  MapPin,
  Shirt,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils";

const TZ = "Australia/Sydney";

const JOB_STATUS_STEPS = [
  "UNASSIGNED",
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
];

const STATUS_LABELS: Record<string, string> = {
  UNASSIGNED: "Unassigned",
  OFFERED: "Offered",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  PAUSED: "Paused",
  WAITING_CONTINUATION_APPROVAL: "Paused",
  SUBMITTED: "Submitted",
  QA_REVIEW: "Under Review",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
};

const STATUS_VARIANT: Record<string, string> = {
  UNASSIGNED: "secondary",
  ASSIGNED: "outline",
  IN_PROGRESS: "default",
  COMPLETED: "success",
  INVOICED: "outline",
};

type Job = {
  id: string;
  jobNumber: string;
  jobType: string;
  status: string;
  scheduledDate: string;
  startTime: string | null;
  endTime: string | null;
  dueTime: string | null;
  notes: string | null;
  actualHours: number | null;
  estimatedHours: number | null;
  property: { id: string; name: string; address: string; suburb: string; state: string; postcode: string };
  assignments: Array<{ user: { id: string; name: string; image: string | null } }>;
  laundryTask: {
    id: string;
    status: string;
    pickupDate: string | null;
    dropoffDate: string | null;
    pickedUpAt: string | null;
    droppedAt: string | null;
    noPickupRequired: boolean;
    skipReasonCode: string | null;
    confirmations: Array<{
      id: string;
      createdAt: string;
      laundryReady: boolean;
      bagLocation: string | null;
      photoUrl: string | null;
      notes: string | null;
    }>;
  } | null;
  invoiceLines: Array<{
    id: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    invoice: {
      id: string;
      invoiceNumber: string;
      status: string;
      totalAmount: number;
      sentAt: string | null;
    } | null;
  }>;
  report: {
    id: string;
    pdfUrl: string | null;
    sentAt: string | null;
    clientVisible: boolean;
    generatedAt: string | null;
    createdAt: string;
  } | null;
  satisfactionRating: { score: number; comment: string | null; createdAt: string } | null;
  auditLogs: Array<{
    id: string;
    action: string;
    entity: string;
    createdAt: string;
    user: { name: string } | null;
  }>;
};

function StatusTimeline({ status }: { status: string }) {
  const currentIdx = JOB_STATUS_STEPS.indexOf(status);
  const effectiveIdx = currentIdx === -1 ? 0 : currentIdx;

  return (
    <div className="flex items-center gap-0">
      {JOB_STATUS_STEPS.map((step, i) => {
        const done = i < effectiveIdx;
        const active = i === effectiveIdx;
        const label = STATUS_LABELS[step] ?? step;
        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`h-3 w-3 rounded-full border-2 transition-colors ${
                  done
                    ? "border-primary bg-primary"
                    : active
                    ? "border-primary bg-primary/20"
                    : "border-muted-foreground/30 bg-muted"
                }`}
              />
              <span className={`text-[9px] font-medium leading-none ${active ? "text-primary" : done ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                {label}
              </span>
            </div>
            {i < JOB_STATUS_STEPS.length - 1 && (
              <div className={`mb-4 h-0.5 w-8 sm:w-12 ${done ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ClientJobDetailPage() {
  const params = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/client/jobs/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Job not found");
        return res.json();
      })
      .then((data) => setJob(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-muted-foreground">{error ?? "Job not found."}</p>
        <Button asChild variant="outline">
          <Link href="/client/jobs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
          </Link>
        </Button>
      </div>
    );
  }

  const scheduled = toZonedTime(new Date(job.scheduledDate), TZ);
  const cleaner = job.assignments[0]?.user;
  const totalCharged = job.invoiceLines.reduce((sum, line) => sum + line.lineTotal, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-1">
          <Link href="/client/jobs">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Jobs
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{job.property.name}</h2>
            <Badge variant={(STATUS_VARIANT[job.status] ?? "outline") as any}>
              {STATUS_LABELS[job.status] ?? job.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {job.jobType.replace(/_/g, " ")} · {format(scheduled, "EEEE d MMMM yyyy")}
            {job.startTime ? ` · ${job.startTime}` : ""}
            {job.jobNumber ? ` · #${job.jobNumber}` : ""}
          </p>
        </div>
      </div>

      {/* Status timeline */}
      <Card>
        <CardContent className="overflow-x-auto py-5">
          <StatusTimeline status={job.status} />
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {job.laundryTask && <TabsTrigger value="laundry">Laundry</TabsTrigger>}
          {job.invoiceLines.length > 0 && <TabsTrigger value="costs">Costs</TabsTrigger>}
          {job.report?.clientVisible && <TabsTrigger value="report">Report</TabsTrigger>}
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Property */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  Property
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium">{job.property.name}</p>
                <p className="text-muted-foreground">{job.property.address}</p>
                <p className="text-muted-foreground">
                  {job.property.suburb} {job.property.state} {job.property.postcode}
                </p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${job.property.address}, ${job.property.suburb} ${job.property.state}`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  <MapPin className="h-3 w-3" />
                  View on map
                </a>
              </CardContent>
            </Card>

            {/* Schedule */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  Schedule
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">{format(scheduled, "EEE d MMM yyyy")}</span>
                </div>
                {job.startTime && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Start time</span>
                    <span className="font-medium">{job.startTime}</span>
                  </div>
                )}
                {job.dueTime && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Due by</span>
                    <span className="font-medium">{job.dueTime}</span>
                  </div>
                )}
                {job.estimatedHours && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. duration</span>
                    <span className="font-medium">{job.estimatedHours}h</span>
                  </div>
                )}
                {job.actualHours && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Actual duration</span>
                    <span className="font-medium">{job.actualHours}h</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cleaner */}
            {cleaner && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    Cleaner
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  {cleaner.image ? (
                    <img src={cleaner.image} alt={cleaner.name} className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {cleaner.name[0]?.toUpperCase()}
                    </div>
                  )}
                  <div>
                    <p className="font-medium text-sm">{cleaner.name}</p>
                    <p className="text-xs text-muted-foreground">Assigned cleaner</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Service */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-primary" />
                  Service
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <p className="font-medium">{job.jobType.replace(/_/g, " ")}</p>
                {job.notes && <p className="text-muted-foreground leading-5">{job.notes}</p>}
              </CardContent>
            </Card>
          </div>

          {/* Satisfaction rating */}
          {job.satisfactionRating && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  Your Rating
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <div className="flex items-center gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className={i < job.satisfactionRating!.score ? "text-amber-400" : "text-muted-foreground/30"}>★</span>
                  ))}
                  <span className="text-muted-foreground ml-1">{job.satisfactionRating.score}/5</span>
                </div>
                {job.satisfactionRating.comment && (
                  <p className="mt-2 text-muted-foreground">{job.satisfactionRating.comment}</p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Laundry tab */}
        {job.laundryTask && (
          <TabsContent value="laundry" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shirt className="h-4 w-4 text-primary" />
                  Laundry Status
                  <Badge variant="outline">{job.laundryTask.status.replace(/_/g, " ")}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {job.laundryTask.noPickupRequired ? (
                  <p className="text-muted-foreground">No laundry pickup required for this job.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {job.laundryTask.pickupDate && (
                      <div className="flex justify-between rounded-lg border p-3">
                        <span className="text-muted-foreground">Pickup date</span>
                        <span className="font-medium">{format(new Date(job.laundryTask.pickupDate), "d MMM yyyy")}</span>
                      </div>
                    )}
                    {job.laundryTask.dropoffDate && (
                      <div className="flex justify-between rounded-lg border p-3">
                        <span className="text-muted-foreground">Return date</span>
                        <span className="font-medium">{format(new Date(job.laundryTask.dropoffDate), "d MMM yyyy")}</span>
                      </div>
                    )}
                    {job.laundryTask.pickedUpAt && (
                      <div className="flex justify-between rounded-lg border p-3">
                        <span className="text-muted-foreground">Picked up</span>
                        <span className="font-medium">{format(new Date(job.laundryTask.pickedUpAt), "d MMM HH:mm")}</span>
                      </div>
                    )}
                    {job.laundryTask.droppedAt && (
                      <div className="flex justify-between rounded-lg border p-3">
                        <span className="text-muted-foreground">Returned</span>
                        <span className="font-medium">{format(new Date(job.laundryTask.droppedAt), "d MMM HH:mm")}</span>
                      </div>
                    )}
                  </div>
                )}
                {job.laundryTask.confirmations.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <p className="font-medium text-xs uppercase tracking-[0.12em] text-muted-foreground">Laundry updates</p>
                    {job.laundryTask.confirmations.map((c) => (
                      <div key={c.id} className="flex gap-3 rounded-xl border p-3">
                        {c.photoUrl && (
                          <img src={c.photoUrl} alt="Laundry" className="h-16 w-16 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs text-muted-foreground">{format(new Date(c.createdAt), "d MMM HH:mm")}</p>
                          {c.laundryReady && <Badge variant="success" className="text-xs">Ready</Badge>}
                          {c.bagLocation && <p className="text-sm"><span className="text-muted-foreground">Location: </span>{c.bagLocation}</p>}
                          {c.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Costs tab */}
        {job.invoiceLines.length > 0 && (
          <TabsContent value="costs" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-primary" />
                  Cost Breakdown
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {job.invoiceLines.map((line) => (
                  <div key={line.id} className="flex items-start justify-between rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{line.description ?? "Service charge"}</p>
                      {line.quantity > 1 && (
                        <p className="text-xs text-muted-foreground">{line.quantity} × {formatCurrency(line.unitPrice)}</p>
                      )}
                      {line.invoice && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Invoice #{line.invoice.invoiceNumber} · {line.invoice.status}
                        </p>
                      )}
                    </div>
                    <span className="font-semibold text-primary">{formatCurrency(line.lineTotal)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-3 font-semibold text-sm">
                  <span>Total charged</span>
                  <span className="text-primary">{formatCurrency(totalCharged)}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Report tab */}
        {job.report?.clientVisible && (
          <TabsContent value="report" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Cleaning Report
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border p-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Job report</p>
                    <p className="text-xs text-muted-foreground">
                      {job.report.generatedAt
                        ? `Generated ${format(new Date(job.report.generatedAt), "d MMM yyyy")}`
                        : "Report available"}
                      {job.report.sentAt ? ` · Sent ${format(new Date(job.report.sentAt), "d MMM")}` : ""}
                    </p>
                  </div>
                  {job.report.pdfUrl && (
                    <Button asChild size="sm" variant="outline">
                      <a href={job.report.pdfUrl} target="_blank" rel="noopener noreferrer">
                        <Download className="mr-2 h-4 w-4" />
                        Download PDF
                      </a>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Timeline tab */}
        <TabsContent value="timeline" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Activity Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No activity recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {job.auditLogs.map((log) => (
                    <div key={log.id} className="flex gap-3 text-sm">
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary/50" />
                      <div className="min-w-0">
                        <p className="font-medium">{log.action.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(log.createdAt), "d MMM yyyy HH:mm")}
                          {log.user ? ` · ${log.user.name}` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
