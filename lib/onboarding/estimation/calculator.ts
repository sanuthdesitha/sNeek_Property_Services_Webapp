import type { EstimationInput, EstimationOutput, EstimationTemplate } from "./types";
import {
  AREA_FALLBACK_BY_PROPERTY,
  DEFAULT_TEMPLATES,
  HEAVY_JOB_TYPES,
  CONDITION_MULTIPLIER,
} from "./rules";

function findTemplate(jobTypes: string[]): EstimationTemplate | null {
  if (jobTypes.length === 0) return null;
  return DEFAULT_TEMPLATES.find((t) => t.appliesTo.includes(jobTypes[0])) ?? null;
}

function resolveSizeSqm(input: EstimationInput): number {
  if (input.sizeSqm && input.sizeSqm > 0) return input.sizeSqm;
  return AREA_FALLBACK_BY_PROPERTY[input.propertyType ?? ""] ?? 100;
}

function findCleanerThresholds(template: EstimationTemplate) {
  return template.minCleanersForSqm;
}

function calculateCleanerCount(sizeSqm: number, thresholds: { minSqm: number; maxSqm?: number; cleaners: number }[]): number {
  const match = thresholds.find((t) => sizeSqm >= t.minSqm && (!t.maxSqm || sizeSqm < t.maxSqm));
  return match?.cleaners ?? 1;
}

export function calculateEstimation(input: EstimationInput): EstimationOutput {
  const template = findTemplate(input.selectedJobTypes);
  const sizeSqm = resolveSizeSqm(input);

  const baseHours = template?.baseHours ?? 3;
  const hoursPerBedroom = template?.hoursPerBedroom ?? 0.5;
  const hoursPerBathroom = template?.hoursPerBathroom ?? 0.5;
  const hoursPerFloor = template?.hoursPerFloor ?? 0.25;
  const hoursPerBalcony = template?.hoursPerBalcony ?? 0.25;
  const hoursPerAppliance = template?.hoursPerAppliance ?? 0.25;
  const hoursPerSpecialRequest = template?.hoursPerSpecialRequest ?? 0.5;
  const hourlyRate = template?.hourlyRate ?? 55;

  let hours = baseHours;
  hours += input.bedrooms * hoursPerBedroom;
  hours += input.bathrooms * hoursPerBathroom;
  hours += Math.max(0, input.floorCount - 1) * hoursPerFloor;
  if (input.hasBalcony) hours += hoursPerBalcony;
  hours += input.applianceCount * hoursPerAppliance;
  hours += input.specialRequestCount * hoursPerSpecialRequest;

  const conditionMult = CONDITION_MULTIPLIER[input.conditionLevel] ?? 1;
  hours = Math.round(hours * conditionMult * 4) / 4;

  const thresholds = template ? findCleanerThresholds(template) : [
    { minSqm: 0, maxSqm: 100, cleaners: 1 },
    { minSqm: 100, maxSqm: 200, cleaners: 2 },
    { minSqm: 200, cleaners: 3 },
  ];
  let suggestedCleaners = calculateCleanerCount(sizeSqm, thresholds);

  const needsExtraCleaners = input.selectedJobTypes.some((jt) => HEAVY_JOB_TYPES.includes(jt));
  if (needsExtraCleaners) suggestedCleaners = Math.max(suggestedCleaners, 2);

  const price = hours * hourlyRate;

  const breakdown = [
    { label: "Base service", amount: Math.round(baseHours * hourlyRate * 100) / 100 },
    { label: `Bedrooms (${input.bedrooms})`, amount: Math.round(input.bedrooms * hoursPerBedroom * hourlyRate * 100) / 100 },
    { label: `Bathrooms (${input.bathrooms})`, amount: Math.round(input.bathrooms * hoursPerBathroom * hourlyRate * 100) / 100 },
    ...(input.hasBalcony ? [{ label: "Balcony", amount: Math.round(hoursPerBalcony * hourlyRate * 100) / 100 }] : []),
    ...(input.applianceCount > 0 ? [{ label: "Special appliances", amount: Math.round(input.applianceCount * hoursPerAppliance * hourlyRate * 100) / 100 }] : []),
    ...(input.specialRequestCount > 0 ? [{ label: "Special requests", amount: Math.round(input.specialRequestCount * hoursPerSpecialRequest * hourlyRate * 100) / 100 }] : []),
  ];

  const warnings: string[] = [];
  if (!input.sizeSqm) warnings.push("Size not provided — using area estimate");
  if (input.selectedJobTypes.length === 0) warnings.push("No job types selected — using general estimate");

  return {
    estimatedHours: hours,
    suggestedCleanerCount: suggestedCleaners,
    estimatedPrice: Math.round(price * 100) / 100,
    priceBreakdown: breakdown,
    confidence: input.sizeSqm ? "high" : "medium",
    warnings,
  };
}
