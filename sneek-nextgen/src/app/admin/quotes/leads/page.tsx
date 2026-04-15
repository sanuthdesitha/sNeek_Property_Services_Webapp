import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, UserPlus, ArrowRight } from "lucide-react";

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-text-primary">Leads</h1><p className="text-text-secondary mt-1">Track and convert potential clients</p></div>
      </div>
      <Card variant="outlined"><CardContent className="pt-4"><Input placeholder="Search leads..." leftIcon={<Search className="h-4 w-4" />} /></CardContent></Card>
      <Card variant="outlined">
        <CardHeader><CardTitle className="text-base">All Leads</CardTitle><CardDescription>Potential clients to follow up with</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Service</TableHead><TableHead>Status</TableHead><TableHead>Estimate</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {[
                { name: "Mike Johnson", email: "mike@example.com", service: "Deep Clean", status: "NEW", estimate: "$200-$300" },
                { name: "Lisa Chen", email: "lisa@example.com", service: "Airbnb Turnover", status: "QUOTED", estimate: "$120-$180" },
                { name: "Tom Brown", email: "tom@example.com", service: "End of Lease", status: "CONTACTED", estimate: "$250-$400" },
              ].map((lead, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium text-sm">{lead.name}</TableCell>
                  <TableCell className="text-sm">{lead.email}</TableCell>
                  <TableCell className="text-sm">{lead.service}</TableCell>
                  <TableCell><Badge variant={lead.status === "NEW" ? "info" : lead.status === "QUOTED" ? "warning" : "neutral"}>{lead.status}</Badge></TableCell>
                  <TableCell className="text-sm">{lead.estimate}</TableCell>
                  <TableCell><Button variant="ghost" size="sm"><ArrowRight className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
