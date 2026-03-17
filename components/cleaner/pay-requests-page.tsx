"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface JobOption {
  id: string;
  label: string;
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

export function CleanerPayRequestsPage({ jobs }: { jobs: JobOption[] }) {
  const [payRequests, setPayRequests] = useState<any[]>([]);
  const [loadingPayRequests, setLoadingPayRequests] = useState(false);
  const [savingPayRequest, setSavingPayRequest] = useState(false);
  const [payJobId, setPayJobId] = useState<string>(jobs[0]?.id ?? "");
  const [payType, setPayType] = useState<"HOURLY" | "FIXED">("HOURLY");
  const [payHours, setPayHours] = useState("1");
  const [payRate, setPayRate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [extraPaymentRequired, setExtraPaymentRequired] = useState(false);

  async function loadPayRequests() {
    setLoadingPayRequests(true);
    const res = await fetch("/api/cleaner/pay-adjustments");
    const body = await res.json().catch(() => []);
    setLoadingPayRequests(false);
    setPayRequests(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    loadPayRequests();
  }, []);

  async function submitPayRequest() {
    if (!extraPaymentRequired) {
      toast({ title: "Select extra payment required first.", variant: "destructive" });
      return;
    }
    if (!payJobId) {
      toast({ title: "Select a job", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      jobId: payJobId,
      type: payType,
      cleanerNote: payNote.trim() || undefined,
    };

    if (payType === "HOURLY") {
      const hours = Number(payHours || 0);
      const rate = Number(payRate || 0);
      if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(rate) || rate <= 0) {
        toast({ title: "Enter valid hours and rate.", variant: "destructive" });
        return;
      }
      payload.requestedHours = hours;
      payload.requestedRate = rate;
    } else {
      const amount = Number(payAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Enter a valid fixed amount.", variant: "destructive" });
        return;
      }
      payload.requestedAmount = amount;
    }

    setSavingPayRequest(true);
    const res = await fetch("/api/cleaner/pay-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPayRequest(false);
    if (!res.ok) {
      toast({ title: "Request failed", description: body.error ?? "Could not submit request.", variant: "destructive" });
      return;
    }

    setPayNote("");
    setPayAmount("");
    setPayHours("1");
    setPayRate("");
    setExtraPaymentRequired(false);
    toast({ title: "Extra payment request submitted" });
    await loadPayRequests();
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Extra Payment Requests</h1>
        <p className="text-sm text-muted-foreground">
          Request additional hourly or fixed payments for completed/submitted jobs and track approvals.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Submit Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
            <Checkbox
              checked={extraPaymentRequired}
              onCheckedChange={(checked) => setExtraPaymentRequired(checked === true)}
            />
            Extra payment required
          </label>

          {!extraPaymentRequired ? (
            <p className="text-xs text-muted-foreground">
              Select the option above to reveal and submit a request.
            </p>
          ) : null}

          {extraPaymentRequired ? (
            <>
          <div>
            <Label className="text-xs text-muted-foreground">Job</Label>
            <Select value={payJobId} onValueChange={setPayJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Select job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Request type</Label>
            <Select value={payType} onValueChange={(value) => setPayType(value as "HOURLY" | "FIXED") }>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HOURLY">Hourly</SelectItem>
                <SelectItem value="FIXED">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {payType === "HOURLY" ? (
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min="0" step="0.25" value={payHours} onChange={(e) => setPayHours(e.target.value)} placeholder="Extra hours" />
              <Input type="number" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder="Rate" />
            </div>
          ) : (
            <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Amount" />
          )}

          <Textarea placeholder="Why extra payment is requested" value={payNote} onChange={(e) => setPayNote(e.target.value)} />

          <Button onClick={submitPayRequest} disabled={savingPayRequest || !jobs.length} className="w-full">
            {savingPayRequest ? "Submitting..." : "Submit Extra Payment Request"}
          </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">My Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingPayRequests ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : payRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <div className="space-y-2">
              {payRequests.map((row: any) => (
                <div key={row.id} className="rounded border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{row.job?.property?.name ?? "Job"}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.job?.jobType?.replace(/_/g, " ")} | {row.type}
                      </p>
                    </div>
                    <Badge
                      variant={
                        row.status === "PENDING"
                          ? ("warning" as any)
                          : row.status === "APPROVED"
                          ? "success"
                          : "destructive"
                      }
                    >
                      {row.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested: {money(row.requestedAmount)}
                    {row.status === "APPROVED" ? ` | Approved: ${money(row.approvedAmount)}` : ""}
                  </p>
                  {row.cleanerNote ? (
                    <p className="mt-1 text-xs text-muted-foreground">Note: {row.cleanerNote}</p>
                  ) : null}
                  {row.adminNote ? (
                    <p className="mt-1 text-xs text-muted-foreground">Admin note: {row.adminNote}</p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
