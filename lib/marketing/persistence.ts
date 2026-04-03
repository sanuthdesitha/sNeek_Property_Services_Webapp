import { JobType } from "@prisma/client";
import { getMarketedService } from "@/lib/marketing/catalog";
import { type MarketedJobTypeValue } from "@/lib/marketing/job-types";

const DIRECT_PRICEBOOK_JOB_TYPES: readonly MarketedJobTypeValue[] = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "GENERAL_CLEAN",
];

const PUBLIC_SERVICE_TO_INTERNAL_JOB_TYPE: Record<MarketedJobTypeValue, JobType> = {
  AIRBNB_TURNOVER: JobType.AIRBNB_TURNOVER,
  DEEP_CLEAN: JobType.DEEP_CLEAN,
  END_OF_LEASE: JobType.END_OF_LEASE,
  GENERAL_CLEAN: JobType.GENERAL_CLEAN,
  POST_CONSTRUCTION: JobType.POST_CONSTRUCTION,
  PRESSURE_WASH: JobType.PRESSURE_WASH,
  WINDOW_CLEAN: JobType.WINDOW_CLEAN,
  LAWN_MOWING: JobType.LAWN_MOWING,
  COMMERCIAL_RECURRING: JobType.COMMERCIAL_RECURRING,
  CARPET_STEAM_CLEAN: JobType.SPECIAL_CLEAN,
  MOLD_TREATMENT: JobType.SPECIAL_CLEAN,
  UPHOLSTERY_CLEANING: JobType.SPECIAL_CLEAN,
  TILE_GROUT_CLEANING: JobType.SPECIAL_CLEAN,
  GUTTER_CLEANING: JobType.PRESSURE_WASH,
  SPRING_CLEANING: JobType.DEEP_CLEAN,
};

export function supportsDirectPriceBookQuery(serviceType: MarketedJobTypeValue) {
  return DIRECT_PRICEBOOK_JOB_TYPES.includes(serviceType);
}

export function normalizePublicServiceTypeForLead(serviceType: MarketedJobTypeValue): JobType {
  return PUBLIC_SERVICE_TO_INTERNAL_JOB_TYPE[serviceType];
}

export function getPublicRequestedServiceLabel(serviceType: MarketedJobTypeValue) {
  return getMarketedService(serviceType)?.label ?? serviceType.replace(/_/g, " ");
}
