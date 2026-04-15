import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, MapPin, Clock, FileText } from "lucide-react";

export default function ClientJobsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Jobs</h1>
        <p className="text-text-secondary mt-1">View your cleaning job history</p>
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-3">
          {[
            { id: "SNK-ABC123", property: "Harbour View Apartment", type: "Airbnb Turnover", date: "Apr 16", time: "10:00 AM", status: "ASSIGNED", cleaner: "John C." },
            { id: "SNK-DEF456", property: "Beach House", type: "Deep Clean", date: "Apr 18", time: "2:00 PM", status: "ASSIGNED", cleaner: "Jane S." },
          ].map((job) => (
            <Card key={job.id} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="info">{job.status.replace(/_/g, " ")}</Badge>
                      <span className="font-mono text-xs text-text-tertiary">{job.id}</span>
                    </div>
                    <h3 className="font-semibold mt-2">{job.property}</h3>
                    <div className="flex items-center gap-4 mt-1 text-sm text-text-tertiary">
                      <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{job.date} at {job.time}</span>
                      <span>{job.type}</span>
                      <span>Cleaner: {job.cleaner}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm">Request Reschedule</Button>
                    <Button variant="outline" size="sm">Request Tasks</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {[
            { id: "SNK-GHI789", property: "Harbour View Apartment", type: "General Clean", date: "Apr 10", status: "COMPLETED", qaScore: 92 },
            { id: "SNK-JKL012", property: "Beach House", type: "Airbnb Turnover", date: "Apr 8", status: "COMPLETED", qaScore: 88 },
          ].map((job) => (
            <Card key={job.id} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">{job.status}</Badge>
                      <span className="font-mono text-xs text-text-tertiary">{job.id}</span>
                    </div>
                    <h3 className="font-semibold mt-2">{job.property}</h3>
                    <div className="flex items-center gap-4 mt-1 text-sm text-text-tertiary">
                      <span>{job.date}</span>
                      <span>{job.type}</span>
                      <span>QA Score: {job.qaScore}%</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm"><FileText className="h-4 w-4 mr-1" />View Report</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
