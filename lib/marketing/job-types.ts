import { JobType } from "@prisma/client";
import { z } from "zod";

export const MARKETED_JOB_TYPE_VALUES = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "GENERAL_CLEAN",
  "POST_CONSTRUCTION",
  "PRESSURE_WASH",
  "WINDOW_CLEAN",
  "LAWN_MOWING",
  "COMMERCIAL_RECURRING",
  "CARPET_STEAM_CLEAN",
  "MOLD_TREATMENT",
  "UPHOLSTERY_CLEANING",
  "TILE_GROUT_CLEANING",
  "GUTTER_CLEANING",
  "SPRING_CLEANING",
] as const;

export type MarketedJobTypeValue = (typeof MARKETED_JOB_TYPE_VALUES)[number];

export const marketedJobTypeSchema = z.enum(MARKETED_JOB_TYPE_VALUES);

export const MARKETING_JOB_TYPES = {
  AIRBNB_TURNOVER: JobType.AIRBNB_TURNOVER,
  DEEP_CLEAN: JobType.DEEP_CLEAN,
  END_OF_LEASE: JobType.END_OF_LEASE,
  GENERAL_CLEAN: JobType.GENERAL_CLEAN,
  POST_CONSTRUCTION: JobType.POST_CONSTRUCTION,
  PRESSURE_WASH: JobType.PRESSURE_WASH,
  WINDOW_CLEAN: JobType.WINDOW_CLEAN,
  LAWN_MOWING: JobType.LAWN_MOWING,
  COMMERCIAL_RECURRING: JobType.COMMERCIAL_RECURRING,
  CARPET_STEAM_CLEAN: "CARPET_STEAM_CLEAN" as unknown as JobType,
  MOLD_TREATMENT: "MOLD_TREATMENT" as unknown as JobType,
  UPHOLSTERY_CLEANING: "UPHOLSTERY_CLEANING" as unknown as JobType,
  TILE_GROUT_CLEANING: "TILE_GROUT_CLEANING" as unknown as JobType,
  GUTTER_CLEANING: "GUTTER_CLEANING" as unknown as JobType,
  SPRING_CLEANING: "SPRING_CLEANING" as unknown as JobType,
} as const;

export function isMarketedJobType(value: string): value is MarketedJobTypeValue {
  return (MARKETED_JOB_TYPE_VALUES as readonly string[]).includes(value);
}
