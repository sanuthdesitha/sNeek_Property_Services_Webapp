import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Eye, Download } from "lucide-react";

export default function ClientReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Reports</h1>
        <p className="text-text-secondary mt-1">View your cleaning reports</p>
      </div>

      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">All Reports</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { job: "SNK-GHI789", property: "Harbour View Apt", type: "General Clean", date: "Apr 10", qaScore: 92 },
              { job: "SNK-JKL012", property: "Beach House", type: "Airbnb Turnover", date: "Apr 8", qaScore: 88 },
            ].map((report) => (
              <div key={report.job} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-text-tertiary" />
                  <div>
                    <p className="text-sm font-medium">{report.property}</p>
                    <p className="text-xs text-text-tertiary">{report.date} &middot; {report.type} &middot; QA: {report.qaScore}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm"><Download className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
