import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar, Clock } from "lucide-react";

export default function ClientBookingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Book a Clean</h1>
        <p className="text-text-secondary mt-1">Self-service booking for your properties</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Booking</CardTitle>
          <CardDescription>Select your property, service type, and preferred date</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <Select label="Property" options={[{ value: "prop_001", label: "Harbour View Apartment" }, { value: "prop_002", label: "Beach House" }]} placeholder="Select property" />
            <Select label="Service Type" options={[{ value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" }, { value: "DEEP_CLEAN", label: "Deep Clean" }, { value: "GENERAL_CLEAN", label: "General Clean" }]} placeholder="Select service" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Preferred Date" type="date" leftIcon={<Calendar className="h-4 w-4" />} />
              <Input label="Preferred Time" type="time" leftIcon={<Clock className="h-4 w-4" />} />
            </div>
            <Textarea label="Special Requests" placeholder="Any specific requirements or notes..." />
            <Button type="submit" className="w-full">Book Now</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Available Slots</CardTitle>
          <CardDescription>Next available cleaning slots</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {["Apr 16 - 10:00 AM", "Apr 16 - 2:00 PM", "Apr 17 - 9:00 AM", "Apr 17 - 1:00 PM", "Apr 18 - 10:00 AM", "Apr 18 - 3:00 PM"].map((slot) => (
              <Button key={slot} variant="outline" size="sm" className="justify-start">{slot}</Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
