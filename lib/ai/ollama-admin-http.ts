import { NextResponse } from "next/server";
export const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "OLLAMA_BUSY" ? 409 : 500;
  return NextResponse.json({ error: status === 409 ? "Another Ollama setup operation is running. Wait for it to finish before retrying." : status === 500 ? "Ollama settings could not be read or saved. If storing an API key, check the server encryption configuration." : message }, { status, headers });
}
