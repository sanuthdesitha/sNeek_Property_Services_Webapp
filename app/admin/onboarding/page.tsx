"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "outline",
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending Review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export default function OnboardingPage() {
  const [surveys, setSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadSurveys() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/admin/onboarding/surveys?${params.toString()}`);
      const data = await res.json().catch(() => []);
      setSurveys(Array.isArray(data) ? data : []);
    } catch {
      setSurveys([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSurveys();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Property Onboarding</h2>
          <p className="text-sm text-muted-foreground">
            Survey new properties and onboard cleaning contracts.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/onboarding/new">
            <Plus className="mr-2 h-4 w-4" />
            New Survey
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search surveys..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadSurveys()}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_LABELS).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={loadSurveys}>Search</Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : surveys.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No surveys yet.{" "}
            <Link href="/admin/onboarding/new" className="text-primary underline">
              Create your first survey
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {surveys.map((survey) => (
            <Card key={survey.id} className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/onboarding/${survey.id}`} className="font-medium text-sm hover:underline">
                        {survey.surveyNumber}
                      </Link>
                      <Badge variant={STATUS_COLORS[survey.status] as any}>
                        {STATUS_LABELS[survey.status]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {survey.propertyName ?? survey.propertyAddress ?? "No property name"}
                      {survey.propertySuburb ? ` — ${survey.propertySuburb}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {survey.bedrooms} bed, {survey.bathrooms} bath
                      {survey.sizeSqm ? ` · ${survey.sizeSqm} sqm` : ""}
                      {survey._count?.appliances ? ` · ${survey._count.appliances} appliance(s)` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(survey.createdAt), "dd MMM yyyy")}
                    </p>
                    {survey.createdProperty && (
                      <Badge variant="success" className="mt-1">Property created</Badge>
                    )}
                    {survey.status === "PENDING_REVIEW" && (
                      <Button asChild size="sm" className="mt-1">
                        <Link href={`/admin/onboarding/${survey.id}`}>Review</Link>
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
