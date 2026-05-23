import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

describe("Dialog", () => {
  it("DialogContent uses rounded-lg (12px)", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dc">
          <DialogHeader><DialogTitle>Title</DialogTitle></DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const cls = screen.getByTestId("dc").className;
    expect(cls).toMatch(/rounded-lg/);
  });

  it("uses bg-surface (not bg-white or hardcoded color)", () => {
    render(
      <Dialog open>
        <DialogContent data-testid="dc">x</DialogContent>
      </Dialog>
    );
    const cls = screen.getByTestId("dc").className;
    expect(cls).toMatch(/bg-surface|bg-background/);
  });
});
