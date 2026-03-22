"use client";

function parseFilenameFromDisposition(contentDisposition: string | null, fallback: string) {
  if (!contentDisposition) return fallback;
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return basicMatch?.[1] || fallback;
}

export async function downloadFromApi(url: string, fallbackFilename: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-progress-toast": "force",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any)?.error ?? "Download failed.");
    }
    const message = await res.text().catch(() => "");
    throw new Error(message || "Download failed.");
  }

  const blob = await res.blob();
  const filename = parseFilenameFromDisposition(res.headers.get("content-disposition"), fallbackFilename);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
