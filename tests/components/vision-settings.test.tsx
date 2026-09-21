import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VisionSettingsPanel } from "@/components/v2/admin/vision-settings";
import { DEFAULT_VISION_SETTINGS } from "@/lib/ai/vision-settings-schema";
afterEach(() => vi.unstubAllGlobals());
it("read-only ops cannot write or check and mounting sends no provider requests", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<VisionSettingsPanel initialSettings={DEFAULT_VISION_SETTINGS} canEdit={false} configured />);
  expect(screen.getByRole("button", { name: "Save vision settings" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Check provider and saved model" })).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});
it("saves bounded settings then explicitly checks model access", async () => {
  const saved = { ...DEFAULT_VISION_SETTINGS, assignmentEnabled: true };
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ settings: saved }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ message: "Access verified; no images sent.", model: saved.model }) });
  vi.stubGlobal("fetch", fetch);
  render(<VisionSettingsPanel initialSettings={DEFAULT_VISION_SETTINGS} canEdit configured />);
  fireEvent.click(screen.getByLabelText("Suggest bulk photo assignments"));
  expect(screen.getByRole("button", { name: "Check provider and saved model" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save vision settings" }));
  await screen.findByText("Vision settings saved.");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(saved);
  fireEvent.click(screen.getByRole("button", { name: "Check provider and saved model" }));
  await screen.findByText(/Access verified; no images sent/);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("preserves unsaved settings on failure and rejects out-of-range batch locally", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Save failed" }) }); vi.stubGlobal("fetch", fetch);
  render(<VisionSettingsPanel initialSettings={DEFAULT_VISION_SETTINGS} canEdit configured />);
  fireEvent.change(screen.getByLabelText("Photos per batch"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: "Save vision settings" }));
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Photos per batch"), { target: { value: "6" } });
  fireEvent.click(screen.getByRole("button", { name: "Save vision settings" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Save failed"));
  expect(screen.getByLabelText("Photos per batch")).toHaveValue(6);
});
it("dedicated training remains opt-in and sends its explicit setting without claiming a trained model", async () => {
  const settings = { ...DEFAULT_VISION_SETTINGS, dedicatedRecognitionEnabled: true };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ settings }) }); vi.stubGlobal("fetch", fetch);
  render(<VisionSettingsPanel initialSettings={DEFAULT_VISION_SETTINGS} canEdit configured recognitionConfigured />);
  const toggle = screen.getByLabelText("Train and use dedicated property recognition");
  expect(toggle).not.toBeChecked(); expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByText(/connectivity and trained model quality are not verified here/)).toBeVisible();
  fireEvent.click(toggle); fireEvent.click(screen.getByRole("button", { name: "Save vision settings" }));
  await screen.findByText("Vision settings saved.");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ dedicatedRecognitionEnabled: true });
});
