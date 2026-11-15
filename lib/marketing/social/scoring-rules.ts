/**
 * Photo score rules for the social post generator (2026-11-17). Plain
 * arithmetic, no AI, no I/O: the server measures a photo with sharp
 * (lib/marketing/social/scoring.ts) and these rules turn the measurements
 * into points and reasons in words. Deterministic: the same measurements
 * always give the same score.
 *
 * Weights (100): source 20, sharpness 20, light 15, contrast 10, size and
 * shape 10 — the "measured" 75 points stored once per photo — plus fresh 15
 * and recency 10, worked out when the list is read (they depend on what was
 * posted and when). Changing a weight bumps SOCIAL_SCORE_VERSION; older rows
 * are scored again lazily.
 */
import { ratioValue, type SocialRatio } from "./networks";
import type { PhotoFieldKind } from "./photo-fields";

export const SOCIAL_SCORE_VERSION = 1;

/** Short side (after the stamp crop) needed for full size points. */
export const FULL_SIZE_SHORT_SIDE = 1080;
/**
 * Below this short side the photo is left out. Stored evidence is resized to
 * 1600 px on the long side before stamping, so a landscape photo keeps about
 * 620 px of height once the stamp band and top strip are cut; 1080 would
 * leave nearly every landscape photo out.
 */
export const MIN_SHORT_SIDE = 600;
export const BLURRY_BELOW = 120;
export const NEAR_DUPLICATE_BITS = 6;

export type PhotoMeasurements = {
  fieldKind: PhotoFieldKind;
  /** After the stamp band and the top strip are cut. */
  width: number;
  height: number;
  /** Variance of the Laplacian on a 1024 px greyscale copy. */
  laplacianVar: number;
  /** Mean luma, 0–255. */
  meanLuma: number;
  /** Share of pixels at 2 or below / 253 or above, 0–1. */
  clipLow: number;
  clipHigh: number;
  /** Standard deviation of luma, 0–255. */
  contrast: number;
};

export type MeasuredComponents = { source: number; sharpness: number; light: number; contrast: number; size: number };

export type MeasuredScore = {
  /** 0–75: the stored part. */
  points: number;
  components: MeasuredComponents;
  reasons: string[];
  /** Set when the photo is left out whatever else happens. */
  leftOut: string | null;
};

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

const SOURCE_POINTS: Record<PhotoFieldKind, number> = { LISTING: 20, FINAL: 12, BEFORE: 8 };

function sharpnessPoints(laplacianVar: number): number {
  return 20 * clamp((laplacianVar - 60) / (400 - 60));
}

function lightPoints(meanLuma: number, clipLow: number, clipHigh: number): number {
  const percent = (meanLuma / 255) * 100;
  let base = 15;
  if (percent < 35) base = 15 * clamp((percent - 10) / 25);
  if (percent > 75) base = 15 * clamp((95 - percent) / 20);
  const penalty = (clip: number) => (clip > 0.04 ? 5 * clamp((clip - 0.04) / 0.16) : 0);
  return Math.max(0, base - penalty(clipLow) - penalty(clipHigh));
}

function contrastPoints(stdev: number): number {
  if (stdev < 40) return 10 * clamp((stdev - 10) / 30);
  if (stdev > 70) return 10 * clamp((110 - stdev) / 40);
  return 10;
}

/** Share of the photo's width or height a centre crop to `ratio` keeps. */
export function ratioKeep(width: number, height: number, ratio: SocialRatio): number {
  if (width <= 0 || height <= 0) return 0;
  const image = width / height;
  const target = ratioValue(ratio);
  return Math.min(image, target) / Math.max(image, target);
}

export function ratioFits(width: number, height: number, ratio: SocialRatio): boolean {
  return ratioKeep(width, height, ratio) >= 0.8;
}

function sizePoints(width: number, height: number, ratio: SocialRatio): number {
  const shortSide = Math.min(width, height);
  const size = 5 * clamp((shortSide - MIN_SHORT_SIDE) / (FULL_SIZE_SHORT_SIDE - MIN_SHORT_SIDE));
  const fit = 5 * clamp((ratioKeep(width, height, ratio) - 0.5) / 0.3);
  return size + fit;
}

/** The stored part of the score, with reasons in words. */
export function measuredScore(input: PhotoMeasurements, ratio: SocialRatio = "4:5"): MeasuredScore {
  const components: MeasuredComponents = {
    source: SOURCE_POINTS[input.fieldKind],
    sharpness: round1(sharpnessPoints(input.laplacianVar)),
    light: round1(lightPoints(input.meanLuma, input.clipLow, input.clipHigh)),
    contrast: round1(contrastPoints(input.contrast)),
    size: round1(sizePoints(input.width, input.height, ratio)),
  };
  const reasons: string[] = [];
  const brightness = Math.round((input.meanLuma / 255) * 100);
  const laplacian = Math.round(input.laplacianVar);
  if (input.fieldKind === "LISTING") reasons.push("Listing-angle or final-look photo");
  if (input.fieldKind === "BEFORE") reasons.push("Before photo: often shows guest belongings");
  if (input.laplacianVar >= 300) reasons.push(`Sharp: fine detail high (Laplacian ${laplacian})`);
  else if (input.laplacianVar >= BLURRY_BELOW) reasons.push(`Sharp enough (Laplacian ${laplacian})`);
  if (brightness >= 35 && brightness <= 75 && input.contrast >= 40) reasons.push("Well lit, good contrast");
  else if (brightness > 75) reasons.push(`Bright (average brightness ${brightness}%)`);
  else if (brightness >= 25 && brightness < 35) reasons.push(`A little dark (average brightness ${brightness}%)`);
  if (input.clipHigh > 0.04) reasons.push(`Highlights clipped (${Math.round(input.clipHigh * 100)}% of the photo)`);
  if (input.clipLow > 0.04) reasons.push(`Shadows clipped (${Math.round(input.clipLow * 100)}% of the photo)`);
  if (input.contrast < 40) reasons.push("Flat contrast");
  reasons.push(`${input.width} × ${input.height} after the stamp is cut off`);

  // Darkness first: a dark photo also measures little detail, and "too dark" is the real reason.
  let leftOut: string | null = null;
  if (brightness < 25) leftOut = `Too dark (average brightness ${brightness}%)`;
  else if (input.laplacianVar < BLURRY_BELOW) leftOut = `Blurry (Laplacian ${laplacian}, needs ${BLURRY_BELOW})`;
  else if (Math.min(input.width, input.height) < MIN_SHORT_SIDE) leftOut = `Too small once the stamp is removed (short side ${Math.min(input.width, input.height)} px, needs ${MIN_SHORT_SIDE})`;

  const points = Math.round(components.source + components.sharpness + components.light + components.contrast + components.size);
  return { points, components, reasons, leftOut };
}

export type LiveScoreInput = {
  measured: { points: number; components: MeasuredComponents; width: number; height: number };
  ratio: SocialRatio;
  usedBefore: boolean;
  nearDuplicate: boolean;
  /** Days since the job was finished (organisation calendar). */
  ageDays: number;
};

export type LiveScore = { score: number; fresh: number; recency: number; size: number };

/** Adds fresh and recency (and the size points for the chosen shape) to the stored part. */
export function liveScore(input: LiveScoreInput): LiveScore {
  const fresh = input.usedBefore || input.nearDuplicate ? 0 : 15;
  const recency = round1(10 * clamp(1 - input.ageDays / 60));
  const size = round1(sizePoints(input.measured.width, input.measured.height, input.ratio));
  const measured = input.measured.points - input.measured.components.size + size;
  return { score: Math.max(0, Math.min(100, Math.round(measured + fresh + recency))), fresh, recency, size };
}

/** Score words shown beside the number. */
export function scoreWord(score: number | null): "Strong" | "Good" | "Fair" | "Weak" | "Not scored" {
  if (score === null) return "Not scored";
  if (score >= 80) return "Strong";
  if (score >= 65) return "Good";
  if (score >= 45) return "Fair";
  return "Weak";
}
