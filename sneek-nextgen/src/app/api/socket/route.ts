import { NextRequest } from "next/server";

// WebSocket endpoint for Next.js App Router
// This is a placeholder — in production, use a dedicated WebSocket server
// or a serverless-compatible solution like Pusher/Ably

export async function GET(req: NextRequest) {
  return new Response("WebSocket endpoint — use a dedicated WS server in production", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
