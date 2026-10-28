/** Bound the entire request, including response-body reads on mobile sockets. */
export async function uploadRequest<T>(
  url: string,
  options: RequestInit,
  read: (response: Response) => Promise<T>,
  parent?: AbortSignal,
  timeoutMs = 30_000
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Upload connection timed out. Retry the saved upload to continue.")), timeoutMs);
  try {
    parent?.throwIfAborted();
    const response = await fetch(url, { ...options, signal: controller.signal });
    return await read(response);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    // Preserve the cancellation reason even if fetch returns a generic abort
    // error or a response reader catches the abort and returns a value.
    controller.signal.throwIfAborted();
  }
}
