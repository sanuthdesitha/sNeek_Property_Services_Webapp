/** Shared deadlines keep the browser alive while CPU-hosted local vision runs. */
export const OLLAMA_INFERENCE_TIMEOUT_MS = 180_000;
export const PHOTO_ASSIGNMENT_REQUEST_TIMEOUT_MS = 240_000;
export function photoAssignmentLimits(provider: string, configuredBatchSize: number) {
  return provider === "ollama"
    ? { batchSize: 1, imageBudget: 4 }
    : { batchSize: configuredBatchSize, imageBudget: 20 };
}
