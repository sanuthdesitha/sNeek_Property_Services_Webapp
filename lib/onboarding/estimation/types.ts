export interface EstimationInput {
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  floorCount: number;
  propertyType: string | null;
  sizeSqm: number | null;
  applianceCount: number;
  specialRequestCount: number;
  conditionLevel: "light" | "standard" | "heavy";
  selectedJobTypes: string[];
  laundryEnabled: boolean;
}

export interface EstimationOutput {
  estimatedHours: number;
  suggestedCleanerCount: number;
  estimatedPrice: number;
  priceBreakdown: { label: string; amount: number }[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
}

export interface EstimationTemplate {
  id: string;
  name: string;
  appliesTo: string[];
  baseHours: number;
  hoursPerBedroom: number;
  hoursPerBathroom: number;
  hoursPerFloor: number;
  hoursPerBalcony: number;
  hoursPerAppliance: number;
  hoursPerSpecialRequest: number;
  hourlyRate: number;
  minCleanersForSqm: { minSqm: number; maxSqm?: number; cleaners: number }[];
}
