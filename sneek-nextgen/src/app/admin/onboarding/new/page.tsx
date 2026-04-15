"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  ArrowRight,
  User,
  Building2,
  Wrench,
  Sparkles,
  Shirt,
  Key,
  Clock,
  Users,
  ListChecks,
  Calculator,
  Plug,
  DollarSign,
  Eye,
  Save,
  Send,
  Camera,
  Plus,
  X,
} from "lucide-react";

const CLEANING_TYPES = [
  "AIRBNB_TURNOVER", "DEEP_CLEAN", "END_OF_LEASE", "GENERAL_CLEAN",
  "POST_CONSTRUCTION", "PRESSURE_WASH", "WINDOW_CLEAN", "LAWN_MOWING",
  "SPECIAL_CLEAN", "COMMERCIAL_RECURRING", "CARPET_STEAM_CLEAN",
  "MOLD_TREATMENT", "UPHOLSTERY_CLEANING", "TILE_GROUT_CLEANING",
  "GUTTER_CLEANING", "SPRING_CLEANING",
];

const APPLIANCES = [
  "Oven", "Rangehood", "Dishwasher", "Microwave", "Fridge",
  "Washing Machine", "Dryer", "Wine Fridge", "Garbage Disposal",
];

const SPECIAL_REQUESTS = [
  "Deep clean areas", "Stain treatment", "Odor removal", "Pet mess",
  "Mold/mildew", "High windows", "Ceiling fans", "Light fixtures",
  "Blinds/curtains", "Carpet spot treatment",
];

const ACCESS_METHODS = [
  "Lockbox", "Key under mat", "Concierge", "Tenant handover",
  "Smart lock", "Code entry",
];

const STEPS = [
  { key: "client", label: "Client", icon: User },
  { key: "property", label: "Property", icon: Building2 },
  { key: "appliances", label: "Appliances", icon: Wrench },
  { key: "special", label: "Special Requests", icon: Sparkles },
  { key: "laundry", label: "Laundry", icon: Shirt },
  { key: "access", label: "Access", icon: Key },
  { key: "timing", label: "Timing", icon: Clock },
  { key: "team", label: "Team", icon: Users },
  { key: "services", label: "Services", icon: ListChecks },
  { key: "ical", label: "iCal", icon: Plug },
  { key: "pricing", label: "Pricing", icon: DollarSign },
  { key: "review", label: "Review", icon: Eye },
];

export default function NewSurveyPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  const updateField = (section: string, field: string, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      [`${section}.${field}`]: value,
    }));
  };

  const nextStep = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prevStep = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const saveSection = async (sectionKey: string) => {
    setSaving(true);
    // Collect fields for this section
    const sectionData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formData)) {
      if (key.startsWith(`${sectionKey}.`)) {
        sectionData[key.replace(`${sectionKey}.`, "")] = value;
      }
    }
    // Would call API here: PATCH /api/admin/onboarding/[id]
    console.log(`Saving section ${sectionKey}:`, sectionData);
    setSaving(false);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Client
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Client Identification</h2>
            <p className="text-sm text-text-secondary">Search for an existing client or create a new one.</p>
            <Input label="Search existing client" placeholder="Name, email, or phone..." helperText="Leave blank to create a new client" />
            <Separator />
            <Input label="Client Name" placeholder="Full name or company name" />
            <Input label="Email" type="email" placeholder="client@example.com" />
            <Input label="Phone" type="tel" placeholder="+61 400 000 000" />
            <Textarea label="Address" placeholder="Full address" />
            <Textarea label="Notes" placeholder="Any additional notes about this client" />
          </div>
        );

      case 1: // Property
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Property Details</h2>
            <Input label="Property Name" placeholder="e.g., Harbour View Apartment" />
            <Input label="Street Address" placeholder="123 Harbour Street" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Suburb" placeholder="Sydney" />
              <Input label="Postcode" placeholder="2000" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Bedrooms" type="number" min={1} placeholder="2" />
              <Input label="Bathrooms" type="number" min={1} placeholder="1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Property Type"
                options={[
                  { value: "house", label: "House" },
                  { value: "apartment", label: "Apartment" },
                  { value: "townhouse", label: "Townhouse" },
                  { value: "unit", label: "Unit" },
                  { value: "villa", label: "Villa" },
                  { value: "duplex", label: "Duplex" },
                ]}
                placeholder="Select type"
              />
              <Input label="Floors/Levels" type="number" min={1} placeholder="1" />
            </div>
            <Checkbox label="Balcony present" />
            <Checkbox label="Garden/outdoor area" />
            <Checkbox label="Garage/carport" />
            <Input label="Latitude" type="number" step="any" helperText="Auto-captured from device GPS" />
            <Input label="Longitude" type="number" step="any" helperText="Auto-captured from device GPS" />
          </div>
        );

      case 2: // Appliances
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Special Appliances & Areas</h2>
            <p className="text-sm text-text-secondary">Select appliances and areas that need special attention.</p>
            <div className="grid grid-cols-2 gap-3">
              {APPLIANCES.map((appliance) => (
                <div key={appliance} className="p-3 rounded-lg border border-border">
                  <Checkbox label={appliance} />
                  <Select
                    label="Condition"
                    options={[
                      { value: "light", label: "Light" },
                      { value: "standard", label: "Standard" },
                      { value: "heavy", label: "Heavy" },
                    ]}
                    placeholder="Condition"
                  />
                </div>
              ))}
            </div>
            <div className="p-4 rounded-lg border-2 border-dashed border-border text-center">
              <Camera className="h-8 w-8 mx-auto text-text-tertiary mb-2" />
              <p className="text-sm text-text-secondary">Take photos of special areas</p>
              <Button variant="outline" size="sm" className="mt-2">
                <Plus className="h-4 w-4 mr-1" /> Add Photo
              </Button>
            </div>
          </div>
        );

      case 3: // Special Requests
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Special Cleaning Requests</h2>
            <p className="text-sm text-text-secondary">Client&apos;s specific requests beyond the standard checklist.</p>
            <div className="grid grid-cols-2 gap-3">
              {SPECIAL_REQUESTS.map((request) => (
                <div key={request} className="p-3 rounded-lg border border-border">
                  <Checkbox label={request} />
                  <Select
                    label="Priority"
                    options={[
                      { value: "must-have", label: "Must Have" },
                      { value: "nice-to-have", label: "Nice to Have" },
                    ]}
                    placeholder="Priority"
                  />
                </div>
              ))}
            </div>
            <Textarea label="Additional Notes" placeholder="Any other special requests from the client..." />
          </div>
        );

      case 4: // Laundry
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Laundry Assessment</h2>
            <Checkbox label="Laundry service enabled for this property" />
            <Input label="Linen buffer sets" type="number" min={0} placeholder="Auto-suggested from bedrooms" helperText="Number of complete linen sets to keep on hand" />
            <Select
              label="Washing Machine Type"
              options={[
                { value: "front-load", label: "Front Load" },
                { value: "top-load", label: "Top Load" },
                { value: "combo", label: "Washer/Dryer Combo" },
              ]}
              placeholder="Select type"
            />
            <Select
              label="Dryer Type"
              options={[
                { value: "vented", label: "Vented" },
                { value: "condenser", label: "Condenser" },
                { value: "heat-pump", label: "Heat Pump" },
                { value: "combo", label: "Washer/Dryer Combo" },
              ]}
              placeholder="Select type"
            />
            <Select
              label="Laundry Area Access"
              options={[
                { value: "indoor", label: "Indoor" },
                { value: "outdoor", label: "Outdoor" },
                { value: "shared", label: "Shared/Communal" },
              ]}
              placeholder="Select access type"
            />
            <Textarea label="Special Laundry Instructions" placeholder="Delicate items, color separation, ironing requirements..." />
          </div>
        );

      case 5: // Access
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Access Details</h2>
            <Select
              label="Access Method"
              options={ACCESS_METHODS.map((m) => ({ value: m.toLowerCase().replace(/\s+/g, "-"), label: m }))}
              placeholder="Select access method"
            />
            <Input label="Access Code / Lockbox Code" placeholder="1234" />
            <Input label="Alarm Code" placeholder="If applicable" />
            <Input label="Key Location" placeholder="e.g., Lockbox at front door" />
            <Textarea label="Entry Instructions" placeholder="Which door, gate code, intercom instructions..." />
            <Textarea label="Access Notes" placeholder="Neighbor has spare key, building hours, security guard..." />
            <Separator />
            <h3 className="text-sm font-medium">Parking</h3>
            <Textarea label="Parking Instructions" placeholder="Street parking, driveway, visitor bay, permit required..." />
            <div className="p-4 rounded-lg border-2 border-dashed border-border text-center">
              <Camera className="h-8 w-8 mx-auto text-text-tertiary mb-2" />
              <p className="text-sm text-text-secondary">Take photos of access points and parking</p>
              <Button variant="outline" size="sm" className="mt-2">
                <Plus className="h-4 w-4 mr-1" /> Add Photo
              </Button>
            </div>
          </div>
        );

      case 6: // Timing
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Timing Instructions</h2>
            <Select
              label="Preferred Cleaning Days"
              options={[
                { value: "monday", label: "Monday" },
                { value: "tuesday", label: "Tuesday" },
                { value: "wednesday", label: "Wednesday" },
                { value: "thursday", label: "Thursday" },
                { value: "friday", label: "Friday" },
                { value: "saturday", label: "Saturday" },
                { value: "sunday", label: "Sunday" },
              ]}
              placeholder="Select days"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Earliest Start Time" type="time" />
              <Input label="Latest Finish Time" type="time" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Check-in Time" placeholder="14:00" helperText="From property/booking" />
              <Input label="Check-out Time" placeholder="10:00" helperText="From property/booking" />
            </div>
            <Checkbox label="Same-day check-in scenario" description="Guest checks out and new guest checks in same day" />
            <Textarea label="Time-sensitive Areas" placeholder='e.g., "Must finish kitchen before 2pm for client arrival"' />
            <Input label="Quiet Hours / Noise Restrictions" placeholder="e.g., No cleaning before 8am or after 6pm" />
            <Input label="Building Access Hours" placeholder="e.g., 7am - 8pm weekdays" />
            <Select
              label="Public Holiday Handling"
              options={[
                { value: "clean", label: "Clean as normal" },
                { value: "skip", label: "Skip on public holidays" },
                { value: "reschedule", label: "Reschedule to next business day" },
              ]}
              placeholder="Select handling"
            />
          </div>
        );

      case 7: // Team
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Team Requirements</h2>
            <Input label="Number of Cleaners Needed" type="number" min={1} placeholder="Auto-suggested from property size" />
            <Textarea label="Team Skill Requirements" placeholder="e.g., Experienced with Airbnb, pet-friendly, eco-products only" />
            <Textarea label="Equipment Needed" placeholder="e.g., Vacuum, mop, steamer, ladder, pressure washer" />
            <Textarea label="Special Equipment Notes" />
            <Select
              label="Preferred Cleaner"
              options={[
                { value: "john", label: "John Cleaner" },
                { value: "jane", label: "Jane Smith" },
                { value: "mike", label: "Mike Johnson" },
              ]}
              placeholder="Select preferred cleaner (optional)"
            />
          </div>
        );

      case 8: // Services
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Cleaning Type Selection</h2>
            <Select
              label="Primary Service Type"
              options={CLEANING_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
              placeholder="Select primary service"
            />
            <div className="space-y-2">
              <label className="text-sm font-medium text-text-primary">Add-on Service Types</label>
              <div className="grid grid-cols-2 gap-2">
                {CLEANING_TYPES.map((type) => (
                  <Checkbox key={type} label={type.replace(/_/g, " ")} />
                ))}
              </div>
            </div>
            <Select
              label="Service Frequency"
              options={[
                { value: "one-time", label: "One-time" },
                { value: "weekly", label: "Weekly" },
                { value: "fortnightly", label: "Fortnightly" },
                { value: "monthly", label: "Monthly" },
                { value: "quarterly", label: "Quarterly" },
                { value: "on-demand", label: "On-demand" },
              ]}
              placeholder="Select frequency"
            />
            <Input label="Contract Start Date" type="date" />
            <Input label="Contract End Date" type="date" helperText="Leave blank for ongoing" />
          </div>
        );

      case 9: // iCal
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">iCal Integration</h2>
            <p className="text-sm text-text-secondary">Connect to your booking platform&apos;s iCal feed for automatic job creation.</p>
            <Input label="iCal URL" placeholder="https://ical.hospitable.com/..." helperText="From Hospitable, Airbnb, or other booking platform" />
            <Select
              label="Provider"
              options={[
                { value: "ICAL_HOSPITABLE", label: "Hospitable" },
                { value: "ICAL_OTHER", label: "Other" },
              ]}
              placeholder="Select provider"
            />
            <Button variant="outline">
              <Plug className="h-4 w-4 mr-2" />
              Test Connection
            </Button>
            <p className="text-xs text-text-tertiary">This is optional. You can add iCal integration later.</p>
          </div>
        );

      case 10: // Pricing
        return (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Pricing & Contract Terms</h2>
            <Card variant="outlined">
              <CardHeader>
                <CardTitle className="text-sm">Auto-Calculated Estimate</CardTitle>
                <CardDescription>Based on collected data</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Estimated Hours</span>
                    <span className="font-medium">4.5 hrs</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Team Size</span>
                    <span className="font-medium">1 cleaner</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Base Rate</span>
                    <span className="font-medium">$150.00</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Add-ons</span>
                    <span className="font-medium">$45.00</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Subtotal</span>
                    <span>$195.00</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">GST (10%)</span>
                    <span>$19.50</span>
                  </div>
                  <div className="flex justify-between text-base font-bold">
                    <span>Total</span>
                    <span>$214.50</span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Select
              label="Payment Terms"
              options={[
                { value: "per-job", label: "Per job invoice" },
                { value: "monthly", label: "Monthly invoice" },
                { value: "upfront", label: "Upfront payment" },
              ]}
              placeholder="Select payment terms"
            />
            <Input label="Discount Code" placeholder="Promo code (optional)" />
            <Textarea label="Contract Notes" placeholder="Any special pricing agreements or terms..." />
            <Select
              label="Cancellation Policy"
              options={[
                { value: "24h", label: "24 hours notice" },
                { value: "48h", label: "48 hours notice" },
                { value: "72h", label: "72 hours notice" },
                { value: "custom", label: "Custom" },
              ]}
              placeholder="Select policy"
            />
          </div>
        );

      case 11: // Review
        return (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold">Review & Submit</h2>
            <p className="text-sm text-text-secondary">Review all collected data before submitting for admin approval.</p>

            {STEPS.slice(0, -1).map((step, i) => (
              <Card key={step.key} variant="outlined">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <step.icon className="h-4 w-4 text-brand-600" />
                    <CardTitle className="text-sm">{step.label}</CardTitle>
                    <Badge variant="success" className="ml-auto">Complete</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-text-tertiary">Data collected — click edit to review</p>
                </CardContent>
              </Card>
            ))}

            <Card variant="outlined" className="border-brand-200 bg-brand-50 dark:bg-brand-900/20">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-brand-800 dark:text-brand-200">What will be created:</h3>
                <ul className="mt-2 space-y-1 text-sm text-brand-700 dark:text-brand-300">
                  <li>• Client profile (new or updated)</li>
                  <li>• Property record with all details and photos</li>
                  <li>• iCal integration (if URL provided)</li>
                  <li>• Form templates for each service type</li>
                  <li>• Price book entries</li>
                  <li>• Property-client rate agreements</li>
                  <li>• Recurring job schedule (if applicable)</li>
                  <li>• Inventory defaults</li>
                  <li>• Laundry settings (if enabled)</li>
                </ul>
                <p className="mt-3 text-xs text-brand-600 dark:text-brand-400">
                  Nothing becomes permanent until an admin reviews and approves this package.
                </p>
              </CardContent>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">New Property Survey</h1>
          <p className="text-text-secondary mt-1">Step {currentStep + 1} of {STEPS.length}: {STEPS[currentStep].label}</p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((step, i) => (
          <button
            key={step.key}
            onClick={() => setCurrentStep(i)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              i === currentStep
                ? "bg-brand-600 text-white"
                : i < currentStep
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                  : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
            }`}
          >
            <step.icon className="h-3 w-3" />
            <span className="hidden sm:inline">{step.label}</span>
          </button>
        ))}
      </div>

      {/* Form */}
      <Card variant="outlined">
        <CardContent className="pt-6">
          {renderStep()}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={currentStep === 0}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => saveSection(STEPS[currentStep].key)} loading={saving}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
          {currentStep < STEPS.length - 1 ? (
            <Button onClick={nextStep}>
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button>
              <Send className="h-4 w-4 mr-2" />
              Submit for Approval
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
