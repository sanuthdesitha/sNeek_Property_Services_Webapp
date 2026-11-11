import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/cleaner/jobs/j", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { BarcodeFieldInput, cameraErrorMessage, scannerSupport } from "@/components/v2/cleaner/barcode-field-input";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, "BarcodeDetector");
  Reflect.deleteProperty(navigator, "mediaDevices");
});

function renderBarcode() {
  const onChange = vi.fn();
  const onCapture = vi.fn();
  render(<BarcodeFieldInput label="Appliance tag" value="" onChange={onChange} onCapture={onCapture} />);
  return { onChange, onCapture };
}

describe("barcode scanner", () => {
  it("reports what the browser supports without asking for the camera", () => {
    expect(scannerSupport(undefined)).toBe("none");
    expect(scannerSupport({ navigator: {} })).toBe("none");
    expect(scannerSupport({ navigator: { mediaDevices: { getUserMedia: () => undefined } } })).toBe("zxing");
    expect(scannerSupport({ BarcodeDetector: function Detector() {}, navigator: { mediaDevices: { getUserMedia: () => undefined } } })).toBe("native");
    expect(cameraErrorMessage({ name: "NotAllowedError" })).toMatch(/blocked/);
  });

  it("typing records manual entry", () => {
    const { onChange, onCapture } = renderBarcode();
    fireEvent.change(screen.getByLabelText("Appliance tag"), { target: { value: "123" } });
    expect(onChange).toHaveBeenCalledWith("123");
    expect(onCapture).toHaveBeenCalledWith({ method: "manual" });
  });

  it("no camera API: says so and keeps the text box (never blocks)", () => {
    renderBarcode();
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    expect(screen.getByRole("status")).toHaveTextContent(/can't use the camera/);
    expect(screen.getByLabelText("Appliance tag")).toBeEnabled();
  });

  it("camera permission denied: closes the scanner with a clear message", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" })) } });
    renderBarcode();
    fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Camera access was blocked/);
    expect(screen.queryByLabelText("Camera view for scanning")).toBeNull();
  });

  it("BarcodeDetector reads a code: fills the answer and records the camera", async () => {
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } });
    class Detector {
      async detect() {
        return [{ rawValue: "9300633603443" }];
      }
    }
    Object.defineProperty(window, "BarcodeDetector", { configurable: true, value: Detector });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    const { onChange, onCapture } = renderBarcode();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Scan/ }));
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("9300633603443"));
    expect(onCapture).toHaveBeenCalledWith({ method: "camera", decoder: "native" });
    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it("the renderer stores how each barcode was captured under the reserved key", () => {
    const onAnswer = vi.fn();
    render(<FormRenderer schema={{ sections: [{ id: "s", title: "S", fields: [{ id: "tag", type: "barcode", label: "Tag" }] }] }} answers={{}} uploads={{}} property={{}} onAnswer={onAnswer} onUpload={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "A1" } });
    expect(onAnswer).toHaveBeenCalledWith("tag", "A1");
    expect(onAnswer).toHaveBeenCalledWith("__barcodeCapture", { tag: { method: "manual" } });
  });
});

describe("searchable select", () => {
  const schema = { sections: [{ id: "s", title: "S", fields: [{ id: "c", type: "select" as const, label: "Colour", searchable: true, options: ["Red", "Blue", "Black"] }] }] };
  it("filters options as you type, keeps the chosen one listed, and says when nothing matches", () => {
    render(<FormRenderer schema={schema} answers={{ c: "Red" }} uploads={{}} property={{}} onAnswer={vi.fn()} onUpload={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Search options for Colour" });
    fireEvent.change(search, { target: { value: "bl" } });
    // "bl" matches Blue and Black; Red stays listed because it is the current answer.
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Select…", "Red", "Blue", "Black"]);
    fireEvent.change(search, { target: { value: "blu" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Select…", "Red", "Blue"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText(/No option matches/)).toBeVisible();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Select…", "Red"]);
  });
  it("is not shown when the question is not searchable", () => {
    render(<FormRenderer schema={{ sections: [{ id: "s", title: "S", fields: [{ ...schema.sections[0].fields[0], searchable: false }] }] }} answers={{}} uploads={{}} property={{}} onAnswer={vi.fn()} onUpload={vi.fn()} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("preview and sandbox modes", () => {
  it("never mounts the real capture: media are pretend counts and the job extras are hidden", () => {
    const onUpload = vi.fn();
    render(
      <FormRenderer
        mode="sandbox"
        schema={{ sections: [{ id: "s", title: "S", fields: [{ id: "p", type: "photo", label: "Oven photo", minPhotos: 1 }] }] }}
        answers={{}}
        uploads={{ p: [] }}
        property={{ inventoryEnabled: true }}
        jobId="job"
        onAnswer={vi.fn()}
        onUpload={onUpload}
      />,
    );
    expect(screen.queryByText("Extras")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add a sample photo to Oven photo" }));
    expect(onUpload).toHaveBeenCalledWith("p", [expect.objectContaining({ key: "sandbox/p/1", url: "" })]);
  });
});
