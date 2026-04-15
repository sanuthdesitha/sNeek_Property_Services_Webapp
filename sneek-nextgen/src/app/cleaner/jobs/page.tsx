import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, MapPin, Clock, ArrowRight, Play, CheckCircle } from "lucide-react";

const STATUS_COLORS: Record<string, "success" | "warning" | "info" | "neutral"> = {
  ASSIGNED: "info",
  EN_ROUTE: "warning",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
};

export default function CleanerJobsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Jobs</h1>
        <p className="text-text-secondary mt-1">View and manage your assigned jobs</p>
      </div>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="space-y-4">
          {[
            { id: "SNK-ABC123", property: "Harbour View Apt", address: "123 Harbour St, Sydney", type: "Airbnb Turnover", time: "10:00 AM", beds: 2, baths: 1, status: "ASSIGNED", estHours: 3 },
            { id: "SNK-DEF456", property: "Beach House", address: "45 Ocean Ave, Bondi", type: "Deep Clean", time: "2:00 PM", beds: 3, baths: 2, status: "ASSIGNED", estHours: 5 },
          ].map((job) => (
            <Card key={job.id} variant="outlined">
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_COLORS[job.status]}>{job.status.replace(/_/g, " ")}</Badge>
                      <span className="font-mono text-xs text-text-tertiary">{job.id}</span>
                    </div>
                    <h3 className="font-semibold text-lg mt-2">{job.property}</h3>
                    <p className="text-sm text-text-secondary flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {job.address}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-text-tertiary">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{job.time}</span>
                      <span>{job.type}</span>
                      <span>{job.beds} bed / {job.baths} bath</span>
                      <span>~{job.estHours}h</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {job.status === "ASSIGNED" && (
                      <>
                        <Button size="sm" asChild>
                          <Link href={`/cleaner/jobs/${job.id}`}>
                            View Details
                            <ArrowRight className="h-3 w-3 ml-1" />
                          </Link>
                        </Button>
                        <Button variant="outline" size="sm">
                          <Play className="h-3 w-3 mr-1" />
                          Start Job
                        </Button>
                      </>
                    )}
                    {job.status === "IN_PROGRESS" && (
                      <Button size="sm">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Complete
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="upcoming">
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <Calendar className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
              <p>No upcoming jobs scheduled</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card variant="outlined">
            <CardContent className="pt-6 text-center text-text-secondary">
              <CheckCircle className="h-8 w-8 mx-auto mb-2 text-text-tertiary" />
              <p>Completed jobs will appear here</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
