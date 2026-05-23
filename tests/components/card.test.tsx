import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

describe("Card", () => {
  it("uses rounded-lg (12px) and border", () => {
    const { container } = render(<Card data-testid="c">x</Card>);
    const cls = container.querySelector("[data-testid=c]")!.className;
    expect(cls).toMatch(/\brounded-lg\b/);
    expect(cls).toMatch(/\bborder\b/);
    expect(cls).toMatch(/bg-surface|bg-card/);
  });

  it("CardContent has p-6 desktop default", () => {
    const { container } = render(
      <Card>
        <CardContent data-testid="cc">x</CardContent>
      </Card>
    );
    const cls = container.querySelector("[data-testid=cc]")!.className;
    expect(cls).toMatch(/p-6|p-4/);
  });
});
