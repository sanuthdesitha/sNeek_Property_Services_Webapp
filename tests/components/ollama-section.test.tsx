import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OllamaSection } from "@/components/v2/admin/settings/ollama-section";
const settings = { baseUrl: "http://ollama:11434", textModel: "text:latest", visionModel: "gemma3:4b", useForText: false, contextTokens: 4096, inferenceTimeoutSeconds: 180, keepAliveMinutes: 5, hasApiKey: true };
const fetchMock = vi.fn();
const json = (data: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status }));
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); fetchMock.mockImplementation(() => json({ settings })); });
it("saves blank key without replacing it and disables diagnostics until edits are saved", async () => {
 render(<OllamaSection />); const url = await screen.findByLabelText("Ollama server address");
 fireEvent.change(url, { target: { value: "http://modelserver:11434" } });
 expect(screen.getByRole("button", { name: "Check all" })).toBeDisabled();
 fetchMock.mockImplementation((_url, init) => init?.method === "PATCH" ? json({ settings: { ...settings, baseUrl: "http://modelserver:11434" } }) : json({ settings }));
 fireEvent.click(screen.getByRole("button", { name: "Save Ollama settings" }));
 await screen.findByText("Settings saved. Run checks to verify this configuration.");
 const body = JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === "PATCH")![1].body);
 expect(body.apiKey).toBeUndefined(); expect(body.clearApiKey).toBe(false);
 expect(screen.getByRole("button", { name: "Check all" })).toBeEnabled();
});
it("runs all diagnostics sequentially despite failure and invalidates results on edits", async () => {
 const observed: string[] = [];
 fetchMock.mockImplementation((_url, init) => { if (init?.method === "POST") { const check = JSON.parse(init.body).check; observed.push(check); return json({ check, ok: check !== "text", message: check === "text" ? "Text model missing" : `${check} verified`, checkedAt: "2026-09-28T00:00:00Z", durationMs: 100 }); } return json({ settings }); });
 render(<OllamaSection />); fireEvent.click(await screen.findByRole("button", { name: "Check all" }));
 await screen.findByText("comparison verified"); expect(observed).toEqual(["connection", "text", "assignment", "comparison"]);
 expect(screen.getByText(/3 of 4 checks passed/)).toBeVisible(); expect(screen.getByText("Text model missing")).toBeVisible();
 fireEvent.change(screen.getByLabelText("Vision model"), { target: { value: "changed:latest" } });
 expect(screen.queryByText("comparison verified")).not.toBeInTheDocument(); expect(screen.getAllByText("Not checked")).toHaveLength(4);
});
it("keeps a rejected save visibly unsaved and allows explicit gateway key removal", async () => {
 render(<OllamaSection />); fireEvent.click(await screen.findByLabelText("Remove stored gateway key when saving"));
 fetchMock.mockImplementation(() => json({ error: "Invalid server address" }, 400));
 fireEvent.click(screen.getByRole("button", { name: "Save Ollama settings" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Invalid server address");
 expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).clearApiKey).toBe(true); expect(screen.getByText("Unsaved changes")).toBeVisible();
});
it("handles chunked download progress and refreshes installed models after confirmed success", async () => {
 fetchMock.mockImplementation((url, init) => {
  if (String(url).endsWith("/pull")) return Promise.resolve(new Response(new ReadableStream({ start(controller) { const encode = new TextEncoder(); controller.enqueue(encode.encode('{"status":"pulling","completed":1,')); controller.enqueue(encode.encode('"total":2}\n{"status":"success"}\n')); controller.close(); } })));
  if (init?.method === "POST") return json({ check: "connection", ok: true, message: "Connected", checkedAt: "2026-09-28T00:00:00Z", durationMs: 1, models: [{ name: "new:model", size: 1024 }], running: [] });
  return json({ settings });
 });
 render(<OllamaSection />); fireEvent.change(await screen.findByLabelText("Model to download"), { target: { value: "new:model" } });
 fireEvent.click(screen.getByRole("button", { name: "Download model" }));
 await screen.findByText(/Model downloaded/); await screen.findByText(/new:model ·/);
 expect(screen.getByLabelText("Vision model")).toHaveValue("gemma3:4b");
});
it("does not report successful download when the stream ends without a success receipt", async () => {
 render(<OllamaSection />); fireEvent.change(await screen.findByLabelText("Model to download"), { target: { value: "new:model" } });
 fetchMock.mockImplementation(() => Promise.resolve(new Response('{"status":"pulling"}\n')));
 fireEvent.click(screen.getByRole("button", { name: "Download model" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("completion was not confirmed"); expect(screen.queryByText(/Model downloaded/)).not.toBeInTheDocument();
});
it("blocks duplicate checks while a request is pending", async () => {
 render(<OllamaSection />); const check = await screen.findByRole("button", { name: "Check connection" });
 fetchMock.mockImplementation(() => new Promise(() => {})); fireEvent.click(check); fireEvent.click(check);
 await waitFor(() => expect(check).toBeDisabled()); expect(fetchMock).toHaveBeenCalledTimes(2);
 expect(screen.getByRole("button", { name: "Download model" })).toBeDisabled();
});
