import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, DollarSign, Users, AlertTriangle, CheckCircle, Clock } from "lucide-react";

const KPI_CARDS = [
  {
    label: "Jobs Today",
    value: "12",
    icon: Briefcase,
    trend: "+3 from yesterday",
    variant: "default" as const,
  },
  {
    label: "Revenue (MTD)",
    value: "$24,500",
    icon: DollarSign,
    trend: "+12% vs last month",
    variant: "success" as const,
  },
  {
    label: "Active Cleaners",
    value: "8",
    icon: Users,
    trend: "2 on route",
    variant: "info" as const,
  },
  {
    label: "Pending Approvals",
    value: "5",
    icon: AlertTriangle,
    trend: "2 pay adjustments",
    variant: "warning" as const,
  },
];

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-1">Overview of your operations</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {KPI_CARDS.map((kpi) => (
          <Card key={kpi.label} variant="outlined">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-text-secondary">{kpi.label}</p>
                <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                <p className="text-xs text-text-tertiary mt-1">{kpi.trend}</p>
              </div>
              <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <kpi.icon className="h-5 w-5 text-text-secondary" />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Immediate Attention */}
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Immediate Attention</CardTitle>
          <CardDescription>Items that need your action right now</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { type: "Pay adjustment", detail: "Cleaner #42 requested +2hrs for Job SNK-ABC123", time: "10 min ago" },
              { type: "Stock alert", detail: "Glass Cleaner running low at 3 properties", time: "1 hour ago" },
              { type: "Job issue", detail: "Damage report submitted for Property: Harbour View", time: "2 hours ago" },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900"
              >
                <AlertTriangle className="h-4 w-4 text-warning-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <Badge variant="warning" className="mb-1">{item.type}</Badge>
                  <p className="text-sm text-text-primary">{item.detail}</p>
                </div>
                <span className="text-xs text-text-tertiary shrink-0">{item.time}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Daily Briefing + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Daily Briefing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { icon: Clock, text: "12 jobs scheduled today" },
                { icon: CheckCircle, text: "8 completed, 3 in progress, 1 pending" },
                { icon: Users, text: "6 cleaners on duty" },
                { icon: Briefcase, text: "2 new leads to review" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                  <item.icon className="h-4 w-4 text-text-tertiary" />
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { action: "Job completed", detail: "SNK-ABC123 — Airbnb Turnover", time: "5 min ago" },
                { action: "Form submitted", detail: "SNK-DEF456 — Deep Clean", time: "15 min ago" },
                { action: "Client registered", detail: "Harbour Properties Pty Ltd", time: "1 hour ago" },
                { action: "Invoice sent", detail: "INV-2026-4521 — $1,200", time: "2 hours ago" },
              ].map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text-primary">{item.action}</p>
                    <p className="text-xs text-text-tertiary">{item.detail}</p>
                  </div>
                  <span className="text-xs text-text-tertiary shrink-0">{item.time}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
