import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowRight } from "lucide-react";

export default function ClientQuotePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Request a Quote</h1>
        <p className="text-text-secondary mt-1">Get a custom quote for your cleaning needs</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Quote Request</CardTitle>
          <CardDescription>Tell us about your cleaning requirements</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <Select label="Service Type" options={[{ value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" }, { value: "DEEP_CLEAN", label: "Deep Clean" }, { value: "END_OF_LEASE", label: "End of Lease" }, { value: "GENERAL_CLEAN", label: "General Clean" }]} placeholder="Select service" />
            <Input label="Property Address" placeholder="123 Harbour Street, Sydney NSW 2000" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Input label="Bedrooms" type="number" min={1} placeholder="2" />
              <Input label="Bathrooms" type="number" min={1} placeholder="1" />
              <Select label="Balcony?" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} placeholder="Select" />
              <Select label="Condition" options={[{ value: "light", label: "Light" }, { value: "standard", label: "Standard" }, { value: "heavy", label: "Heavy" }]} placeholder="Select" />
            </div>
            <Textarea label="Additional Notes" placeholder="Any special requirements or requests..." />
            <Button type="submit" className="w-full" size="lg">Submit Quote Request<ArrowRight className="h-4 w-4 ml-2" /></Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
