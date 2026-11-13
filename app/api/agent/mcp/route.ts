import { NextResponse } from "next/server";
import { handleMcpPost } from "@/lib/agents/mcp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };
const MAX_BODY = 64 * 1024;

/**
 * MCP endpoint for connected agents (Streamable HTTP, JSON responses).
 * Authenticated ONLY by an agent bearer token (lib/agents/access.ts); session
 * cookies are never read here, and agent tokens are never accepted by any
 * other route.
 */
export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large." } }, { status: 413, headers: HEADERS });
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { invalid: true }; }
  try {
    const result = await handleMcpPost({ authorization: request.headers.get("authorization"), body });
    if (result.body === null) return new NextResponse(null, { status: result.status, headers: { ...HEADERS, ...result.headers } });
    return NextResponse.json(result.body, { status: result.status, headers: { ...HEADERS, ...result.headers } });
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "The server could not answer right now." } }, { status: 500, headers: HEADERS });
  }
}

/** No server-initiated stream: this server only answers requests. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}
