import path from "node:path";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const filePath = path.join(process.cwd(), "public", "icon-192.png");
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch {
    return Response.redirect(new URL("/icon", req.url), 307);
  }
}

