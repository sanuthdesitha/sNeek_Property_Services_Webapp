"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface StepReviewProps {
  surveyId: string;
  data: Record<string, unknown>;
  onComplete: () => void;
}

export function StepReview({ surveyId, data, onComplete }: StepReviewProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function submitForReview() {
    if (!data.existingClientId && !data.isNewClient) {
      toast({ title: "Client required", description: "Link an existing client or create a new one.", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/onboarding/surveys/${surveyId}/submit`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to submit");
      }
      toast({ title: "Submitted for review" });
      onComplete();
      router.push("/admin/onboarding");
    } catch (err: any) {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const clientData = (data.clientData as Record<string, unknown>) ?? {};
  const laundryDetail = (data.laundryDetail as Record<string, unknown>) ?? {};

  const sections: { title: string; items: (string | null)[] }[] = [
    {
      title: "Client",
      items: (data.isNewClient
        ? [`New: ${String(clientData.name ?? "Unnamed")}`, clientData.email ? String(clientData.email) : null, clientData.phone ? String(clientData.phone) : null].filter(Boolean)
        : [`Existing client: ${data.existingClientId}`]) as (string | null)[],
    },
    {
      title: "Property",
      items: ([
        data.propertyName,
        data.propertyAddress,
        data.propertySuburb,
        `${data.bedrooms} bed, ${data.bathrooms} bath`,
        data.propertyType,
        data.sizeSqm ? `${data.sizeSqm} sqm` : null,
      ].filter(Boolean)) as (string | null)[],
    },
    {
      title: "Appliances",
      items: ((data.appliances as any[]) ?? []).map((a) => `${a.applianceType}${a.requiresClean ? " (clean)" : ""}`),
    },
    {
      title: "Special Requests",
      items: ((data.specialRequests as any[]) ?? []).map((r) => `[${r.priority}] ${r.description}`),
    },
    {
      title: "Laundry",
      items: laundryDetail.hasLaundry
        ? [
            "Laundry enabled",
            data.laundrySupplierId ? `Partner: ${data.laundrySupplierId}` : "No partner assigned",
          ]
        : ["No laundry"],
    },
    {
      title: "Access Details",
      items: ((data.accessDetails as any[]) ?? []).map((d) => `${d.detailType}: ${d.value ?? "Photo added"}`),
    },
    {
      title: "Staffing",
      items: [
        `Requested: ${data.requestedCleanerCount ?? 1} cleaner(s)`,
        data.estimatedHours ? `Estimated: ${data.estimatedHours}h` : null,
        data.estimatedPrice ? `Est. price: $${Number(data.estimatedPrice).toFixed(2)}` : null,
      ].filter(Boolean),
    },
    {
      title: "Cleaning Types",
      items: ((data.selectedJobTypes as string[]) ?? []).map((jt) => jt.replace(/_/g, " ")),
    },
    {
      title: "iCal",
      items: data.icalUrl ? [`URL: ${data.icalUrl}`] : ["Not provided"],
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Review all collected information before submitting for admin review.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {section.items.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {section.items.map((item: string | null, i) => (
                    item && <li key={i} className="text-muted-foreground">{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => window.history.back()}>
          Go Back
        </Button>
        <Button onClick={submitForReview} disabled={submitting}>
          {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Submit for Review
        </Button>
      </div>
    </div>
  );
}
