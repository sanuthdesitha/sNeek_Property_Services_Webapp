import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GlobalShortcutListener, useShortcut } from "@/hooks/use-keyboard-shortcuts";

function Component({ onTrigger }: { onTrigger: () => void }) {
  useShortcut({ keys: "?", label: "Help", handler: onTrigger });
  return <GlobalShortcutListener />;
}

describe("keyboard shortcuts", () => {
  it("triggers handler on matching key", () => {
    const handler = vi.fn();
    render(<Component onTrigger={handler} />);
    fireEvent.keyDown(document, { key: "?" });
    expect(handler).toHaveBeenCalled();
  });

  it("does not trigger when typing in input", () => {
    const handler = vi.fn();
    const { getByTestId } = render(
      <div>
        <input data-testid="i" />
        <Component onTrigger={handler} />
      </div>
    );
    const input = getByTestId("i") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(handler).not.toHaveBeenCalled();
  });
});
