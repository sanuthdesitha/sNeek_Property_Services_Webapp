import "server-only";

export function getAiConfiguration(): { provider: string; model: string; configured: boolean } {
  return {
    provider: "anthropic",
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
    // Presence alone does not establish connectivity or credential validity.
    configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
  };
}
