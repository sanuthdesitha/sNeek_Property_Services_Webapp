import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UploadDropzone } from "@/components/ui/upload-dropzone";

describe("UploadDropzone", () => {
  it("renders the empty dropzone state", () => {
    render(<UploadDropzone onUploaded={() => {}} />);
    expect(screen.getByText(/Drag files here/i)).toBeInTheDocument();
  });
});
