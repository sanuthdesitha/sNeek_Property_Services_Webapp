import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewJobPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild><Link href="/admin/jobs"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
        <div><h1 className="text-2xl font-bold text-text-primary">Create New Job</h1><p className="text-text-secondary mt-1">Schedule a new cleaning job</p></div>
      </div>
      <Card variant="outlined">
        <CardContent className="pt-6">
          <form className="space-y-4">
            <Select label="Property" options={[{ value: "prop_001", label: "Harbour View Apartment" }, { value: "prop_002", label: "Beach House" }]} placeholder="Select property" />
            <Select label="Service Type" options={[{ value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" }, { value: "DEEP_CLEAN", label: "Deep Clean" }, { value: "END_OF_LEASE", label: "End of Lease" }, { value: "GENERAL_CLEAN", label: "General Clean" }]} placeholder="Select type" />
            <div className="grid grid-cols-2 gap-4"><Input label="Scheduled Date" type="date" /><Input label="Due Time" type="time" /></div>
            <div className="grid grid-cols-2 gap-4"><Input label="Start Time" type="time" /><Input label="End Time" type="time" /></div>
            <Input label="Estimated Hours" type="number" step="0.5" placeholder="3" />
            <Select label="Assign Cleaner" options={[{ value: "cleaner_001", label: "John C." }, { value: "cleaner_002", label: "Jane S." }]} placeholder="Select cleaner (optional)" />
            <Textarea label="Notes" placeholder="Any special instructions..." />
            <Textarea label="Internal Notes" placeholder="Notes visible only to admin..." />
            <Button type="submit" className="w-full">Create Job</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
