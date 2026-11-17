/**
 * Scripted XMLHttpRequest for upload transport tests. Each `send` is recorded
 * and handed to `FakeXhr.onSend`, which drives progress and the response.
 */
type ProgressHandler = ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;

export class FakeXhr {
  static instances: FakeXhr[] = [];
  static onSend: (xhr: FakeXhr) => void = () => {};
  static open = 0;
  static maxOpen = 0;

  static reset() {
    FakeXhr.instances = [];
    FakeXhr.onSend = () => {};
    FakeXhr.open = 0;
    FakeXhr.maxOpen = 0;
  }

  method = "";
  url = "";
  requestHeaders: Record<string, string> = {};
  body: Blob | null = null;
  status = 0;
  responseText = "";
  responseHeaders: Record<string, string> = {};
  aborted = false;
  finished = false;
  upload: { onprogress: ProgressHandler; onload: (() => void) | null } = { onprogress: null, onload: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onprogress: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: Blob) {
    this.body = body;
    FakeXhr.instances.push(this);
    FakeXhr.open++;
    FakeXhr.maxOpen = Math.max(FakeXhr.maxOpen, FakeXhr.open);
    FakeXhr.onSend(this);
  }
  abort() {
    if (this.finished) return;
    this.aborted = true;
    this.close();
    this.onabort?.();
  }

  /** Report `loaded` bytes of the body as sent. */
  progress(loaded: number) {
    if (this.finished) return;
    this.upload.onprogress?.({ loaded, total: this.body?.size ?? 0, lengthComputable: true });
  }
  respond(status: number, headers: Record<string, string> = {}, text = "") {
    if (this.finished) return;
    this.upload.onload?.();
    this.status = status;
    this.responseText = text;
    this.responseHeaders = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    this.close();
    this.onload?.();
  }
  fail() {
    if (this.finished) return;
    this.close();
    this.onerror?.();
  }
  private close() {
    this.finished = true;
    FakeXhr.open--;
  }
}
