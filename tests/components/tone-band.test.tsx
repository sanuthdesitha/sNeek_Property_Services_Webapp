import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  E_TONES,
  EToneCard,
  EToneNotice,
  EToneRowCell,
  toneBandClass,
  toneFromLegacy,
  toneMutedClass,
  toneNoticeClass,
  tonePillClass,
  toneRowCellClass,
  type ETone,
} from "@/components/v2/ui/tone-band";
import { EAlert } from "@/components/v2/ui/primitives";

/** The owner replaced the coloured left line with the tinted title band (set 1). */
describe("tone band classes", () => {
  it.each(E_TONES)("%s maps to its own band tokens and never to a left line", (tone: ETone) => {
    for (const cls of [toneBandClass(tone), toneNoticeClass(tone)]) {
      expect(cls).toContain(`bg-[hsl(var(--e-band-${tone}-bg))]`);
      expect(cls).toContain(`border-[hsl(var(--e-band-${tone}-line))]`);
      expect(cls).toContain(`text-[hsl(var(--e-band-${tone}-fg))]`);
      expect(cls).not.toMatch(/border-l-/);
    }
    expect(toneBandClass(tone).split(" ")).toContain("border-b");
    expect(toneNoticeClass(tone).split(" ")).toContain("border");
    expect(toneMutedClass(tone)).toBe(`text-[hsl(var(--e-band-${tone}-muted))]`);
    expect(tonePillClass(tone)).toContain(`text-[hsl(var(--e-band-${tone}-pill))]`);
    expect(tonePillClass(tone)).toContain("bg-[hsl(var(--e-surface))]");
    expect(toneRowCellClass(tone)).toContain(`bg-[hsl(var(--e-band-${tone}-bg))]`);
  });

  it("maps the older semantic tones onto band tones", () => {
    expect(toneFromLegacy("warning")).toBe("attention");
    expect(toneFromLegacy("danger")).toBe("problem");
    expect(toneFromLegacy("success")).toBe("good");
    expect(toneFromLegacy("info")).toBe("info");
  });
});

describe("tone band shapes", () => {
  it("a flagged card puts the title row in the band with the written reason pill", () => {
    const { container } = render(
      <EToneCard tone="attention" header={<b>CleanCo Laundry</b>} pill="1 late">
        <p>Logins 3</p>
      </EToneCard>,
    );
    const band = container.querySelector('[data-tone="attention"] > [data-tone="attention"]');
    expect(band).not.toBeNull();
    expect(band).toHaveTextContent("CleanCo Laundry");
    expect(band?.className).toContain("border-b");
    const pill = screen.getByText("1 late");
    expect(band).toContainElement(pill);
    expect(pill.className).toContain("bg-[hsl(var(--e-surface))]");
    // The body stays on the plain surface, outside the band.
    expect(band).not.toContainElement(screen.getByText("Logins 3"));
    expect(container.innerHTML).not.toMatch(/border-l-/);
  });

  it("a card with nothing to flag has no band", () => {
    const { container } = render(<EToneCard header={<b>Manly Loft</b>} pill="Planned" />);
    expect(container.querySelector("[data-tone]")).toBeNull();
    expect(container.innerHTML).not.toContain("--e-band-");
    expect(screen.getByText("Planned")).toBeInTheDocument();
  });

  it("a flagged table row tints only its leading cell and keeps the pill", () => {
    render(
      <table>
        <tbody>
          <tr>
            <EToneRowCell tone="problem">
              Coogee Terrace <span>Failed pickup</span>
            </EToneRowCell>
            <td>Thu 14:00</td>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByText("Failed pickup").closest("td");
    expect(cell?.getAttribute("data-tone")).toBe("problem");
    expect(cell?.className).toContain("bg-[hsl(var(--e-band-problem-bg))]");
    expect(screen.getByText("Thu 14:00").className).toBe("");
  });

  it("an unflagged row cell stays plain", () => {
    render(
      <table>
        <tbody>
          <tr>
            <EToneRowCell>Glebe House</EToneRowCell>
          </tr>
        </tbody>
      </table>,
    );
    const cell = screen.getByText("Glebe House");
    expect(cell.getAttribute("data-tone")).toBeNull();
    expect(cell.className).toBe("");
  });

  it("notices and EAlert take the tint with a hairline, not a left bar", () => {
    const { container } = render(
      <>
        <EToneNotice tone="good" title="Delivered">Back Wed 09:15</EToneNotice>
        <EAlert tone="warning" title="Check the keys">Lockbox code changed</EAlert>
      </>,
    );
    const alert = screen.getByText("Check the keys").parentElement;
    expect(alert?.getAttribute("data-tone")).toBe("attention");
    expect(alert?.className).toContain("bg-[hsl(var(--e-band-attention-bg))]");
    expect(screen.getByText("Delivered").parentElement?.getAttribute("data-tone")).toBe("good");
    expect(container.innerHTML).not.toMatch(/border-l-/);
    expect(container.innerHTML).not.toContain("style=");
  });
});
