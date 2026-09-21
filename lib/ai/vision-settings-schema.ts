import { z } from "zod";

export const visionSettingsSchema = z.object({
  // Older saved settings and queued reviews used Anthropic.
  provider: z.enum(["openai", "anthropic", "ollama"]).default("anthropic"),
  comparisonEnabled: z.boolean(),
  assignmentEnabled: z.boolean(),
  historicalAssignmentExamplesEnabled: z.boolean().default(true),
  dedicatedRecognitionEnabled: z.boolean().default(false),
  batchSize: z.number().int().min(1).max(8),
  minConfidence: z.number().min(0).max(1),
  maxScoreContribution: z.number().min(0).max(20),
  scoreMode: z.literal("review"),
  model: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/).refine(value => !value.includes("://"), "Enter a model name, not a URL"),
}).strict();
export type VisionSettings = z.infer<typeof visionSettingsSchema>;
export const DEFAULT_VISION_SETTINGS: VisionSettings = {
  provider: "openai",
  comparisonEnabled: false, assignmentEnabled: false, historicalAssignmentExamplesEnabled: true, dedicatedRecognitionEnabled: false, batchSize: 4,
  minConfidence: 0.8, maxScoreContribution: 10, scoreMode: "review", model: "gpt-4.1",
};
