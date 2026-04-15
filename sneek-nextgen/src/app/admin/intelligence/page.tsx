import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Users, DollarSign, Briefcase, AlertTriangle } from "lucide-react";

export default function IntelligencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Intelligence</h1>
        <p className="text-text-secondary mt-1">Business intelligence and analytics</p>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: "Total Revenue (YTD)", value: "$142,500", change: "+18%", icon: DollarSign, trend: "up" as const },
          { label: "Jobs Completed (YTD)", value: "486", change: "+12%", icon: Briefcase, trend: "up" as const },
          { label: "Active Cleaners", value: "8", change: "+2", icon: Users, trend: "up" as const },
          { label: "Avg Job Margin", value: "35%", change: "-2%", icon: TrendingUp, trend: "down" as const },
          { label: "Client Retention", value: "92%", change: "+5%", icon: BarChart3, trend: "up" as const },
          { label: "Open Issues", value: "3", change: "-1", icon: AlertTriangle, trend: "up" as const },
        ].map((kpi) => (
          <Card key={kpi.label} variant="outlined">
            <div className="flex items-center gap-3 p-4">
              <div className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                <kpi.icon className="h-5 w-5 text-text-secondary" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">{kpi.label}</p>
                <p className="text-2xl font-bold">{kpi.value}</p>
                <p className={`text-xs ${kpi.trend === "up" ? "text-success-600" : "text-danger-600"}`}>
                  {kpi.change} vs last period
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Placeholder charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Revenue Trend</CardTitle>
            <CardDescription>Monthly revenue over the past 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-end justify-around gap-2">
              {[18000, 22000, 19500, 24000, 21000, 24500].map((val, i) => (
                <div key={i} className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className="w-full bg-brand-500 rounded-t transition-all"
                    style={{ height: `${(val / 25000) * 160}px` }}
                  />
                  <span className="text-xs text-text-tertiary">
                    {["Nov", "Dec", "Jan", "Feb", "Mar", "Apr"][i]}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-base">Jobs by Type</CardTitle>
            <CardDescription>Distribution of cleaning job types</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { type: "Airbnb Turnover", count: 186, pct: 38 },
                { type: "Deep Clean", count: 98, pct: 20 },
                { type: "General Clean", count: 87, pct: 18 },
                { type: "End of Lease", count: 65, pct: 13 },
                { type: "Other", count: 50, pct: 11 },
              ].map((item) => (
                <div key={item.type}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span>{item.type}</span>
                    <span className="text-text-tertiary">{item.count} ({item.pct}%)</span>
                  </div>
                  <div className="h-2 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
