import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { localModel, ollamaFetch, readOllamaResponse, ollamaFailure, OllamaError } from "@/lib/ai/ollama";
import { acquireOllamaOperation } from "@/lib/ai/ollama-admin-operation";
import { headers, failure } from "@/lib/ai/ollama-admin-http";
export const dynamic = "force-dynamic";
export const maxDuration = 1800;
export async function POST(request: Request) {
  let release: (() => Promise<void>) | undefined;
  try {
    await requireRole([Role.ADMIN]);
    const body = await request.json().catch(() => null);
    if (typeof body?.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*(?::[a-zA-Z0-9._-]+)?$/.test(body.model)) return NextResponse.json({ error: "Enter a local Ollama library model name and tag." }, { status: 400, headers });
    try { localModel(body.model); } catch { return NextResponse.json({ error: "Cloud models cannot be downloaded here. Choose a local model." }, { status: 400, headers }); }
    release = await acquireOllamaOperation(31 * 60_000);
    const response = await ollamaFetch("pull", { model: body.model, stream: true });
    if (!response.ok || response.redirected || !response.body) {
      try { await readOllamaResponse(response); } catch (error) { return NextResponse.json({ error: ollamaFailure(error).message }, { status: 502, headers }); }
      return NextResponse.json({ error: "Ollama did not return download progress." }, { status: 502, headers });
    }
    const finish = release; release = undefined;
    const reader = response.body.getReader(); const decoder = new TextDecoder(); const encoder = new TextEncoder();
    let pending = "", completed = false, closed = false, totalBytes = 0;
    const clean = async () => { if (closed) return; closed = true; await reader.cancel().catch(() => undefined); await finish().catch(() => undefined); };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (!chunk.done) { totalBytes += chunk.value.length; pending += decoder.decode(chunk.value, { stream: true }); }
          else pending += decoder.decode();
          if (pending.length > 64_000 || totalBytes > 16 * 1024 * 1024) throw new Error("Oversized progress");
          const lines = pending.split("\n"); pending = chunk.done ? "" : lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            const value = JSON.parse(line);
            if (value.error) throw new Error("Download failed");
            if (typeof value.status !== "string" || value.status.length > 500) throw new Error("Invalid progress");
            // Never forward provider text or local paths. Only known progress states and byte counts.
            const status = value.status === "success" ? "success" : /^pulling/.test(value.status) ? "Downloading model" : /^verifying/.test(value.status) ? "Verifying model" : /^writing|^removing/.test(value.status) ? "Installing model" : "Preparing model";
            if (status === "success") completed = true;
            const counts = Number.isFinite(value.completed) && value.completed >= 0 && Number.isFinite(value.total) && value.total > 0 && value.completed <= value.total ? { completed: value.completed, total: value.total } : {};
            controller.enqueue(encoder.encode(JSON.stringify({ status, ...counts }) + "\n"));
          }
          if (chunk.done) {
            if (!completed) controller.enqueue(encoder.encode(JSON.stringify({ error: "Download ended without confirmation. Refresh installed models before retrying." }) + "\n"));
            await clean(); controller.close();
          }
        } catch {
          controller.enqueue(encoder.encode(JSON.stringify({ error: "Model download was interrupted or failed. Check server disk space and internet access, then refresh installed models before retrying." }) + "\n"));
          await clean(); controller.close();
        }
      },
      async cancel() { await clean(); },
    });
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson", "X-Accel-Buffering": "no" } });
  } catch (error) { return error instanceof OllamaError ? NextResponse.json({ error: error.message }, { status: 502, headers }) : failure(error); }
  finally { await release?.().catch(() => undefined); }
}
