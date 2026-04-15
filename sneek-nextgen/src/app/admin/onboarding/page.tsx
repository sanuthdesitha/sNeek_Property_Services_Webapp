import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, CheckCircle, Clock, AlertTriangle, XCircle } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "info" | "danger" | "neutral"; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  DRAFT: { variant: "neutral", icon: FileText, label: "Draft" },
  SUBMITTED: { variant: "info", icon: Clock, label: "Submitted" },
  UNDER_REVIEW: { variant: "warning", icon: AlertTriangle, label: "Under Review" },
  APPROVED: { variant: "success", icon: CheckCircle, label: "Approved" },
  REJECTED: { variant: "danger", icon: XCircle, label: "Rejected" },
};

export default function OnboardingPage() {
  // Placeholder data — will be fetched from API
  const surveys = [
    { id: "1", status: "SUBMITTED", property: "123 Harbour St, Sydney", surveyor: "John Cleaner", date: "2026-04-15", types: "Airbnb Turnover + Deep Clean" },
    { id: "2", status: "UNDER_REVIEW", property: "45 Ocean Ave, Bondi", surveyor: "Ops Manager", date: "2026-04-14", types: "End of Lease" },
    { id: "3", status: "APPROVED", property: "78 Park Rd, Manly", surveyor: "Admin User", date: "2026-04-13", types: "General Clean" },
    { id: "4", status: "DRAFT", property: "90 Beach Rd, Coogee", surveyor: "Admin User", date: "2026-04-12", types: "Pressure Wash" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Property Onboarding</h1>
          <p className="text-text-secondary mt-1">Manage property surveys and onboarding packages</p>
        </div>
        <Button asChild>
          <Link href="/admin/onboarding/new">
            <Plus className="h-4 w-4 mr-2" />
            New Survey
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: "Draft", count: 1, status: "DRAFT" },
          { label: "Submitted", count: 1, status: "SUBMITTED" },
          { label: "Under Review", count: 1, status: "UNDER_REVIEW" },
          { label: "Approved", count: 1, status: "APPROVED" },
        ].map((stat) => (
          <Card key={stat.status} variant="outlined">
            <CardContent className="pt-6">
              <p className="text-sm text-text-secondary">{stat.label}</p>
              <p className="text-2xl font-bold mt-1">{stat.count}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Surveys list */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Recent Surveys</CardTitle>
          <CardDescription>All property onboarding surveys</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {surveys.map((survey) => {
              const config = STATUS_CONFIG[survey.status];
              const Icon = config.icon;
              return (
                <div
                  key={survey.id}
                  className="flex items-center gap-4 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900"
                >
                  <Badge variant={config.variant}>
                    <Icon className="h-3 w-3 mr-1" />
                    {config.label}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{survey.property}</p>
                    <p className="text-xs text-text-tertiary">
                      {survey.types} &middot; by {survey.surveyor} &middot; {survey.date}
                    </p>
                  </div>
                  {survey.status === "SUBMITTED" || survey.status === "UNDER_REVIEW" ? (
                    <Button size="sm" asChild>
                      <Link href={`/admin/onboarding/packages/${survey.id}`}>Review</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/onboarding/${survey.id}`}>View</Link>
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
