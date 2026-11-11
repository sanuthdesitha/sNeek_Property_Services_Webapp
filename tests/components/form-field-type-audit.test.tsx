/**
 * Field type audit: one case per REGISTERED field type (lib/forms/field-types),
 * covering (a) the builder definition and default config pass the strict save
 * check, (b) the cleaner renderer shows the type and produces the answer shape
 * the server reads, (c) server validation accepts a valid answer and flags each
 * invalid one. The test fails if a type is added to the registry without a case.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/cleaner/jobs/j", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { FIELD_TYPES } from "@/lib/forms/field-types";
import { validateFormSchemaForSave } from "@/lib/forms/template-schema";
import { collectFormErrors, extendedFieldError } from "@/lib/forms/validate-submission";
import { makeField } from "@/components/v2/admin/forms/builder/use-builder-editing";
import type { FormField, FormFieldType } from "@/lib/forms/types";

type Case = {
  /** Extra config for the question under test. */
  config?: Partial<FormField>;
  /** Drive the rendered control; resolves to nothing (answer captured via onAnswer). */
  interact?: () => void;
  /** Expected answer shape after `interact` (undefined: not interactive in jsdom, e.g. signature/location/media). */
  produced?: unknown;
  valid: unknown;
  invalid: unknown[];
  /** Upload types: validated by count, not by answer. */
  upload?: { valid: number; invalid: number };
};

const input = () => screen.getByLabelText("Question") as HTMLInputElement;

const CASES: Record<FormFieldType, Case> = {
  text: { interact: () => fireEvent.change(input(), { target: { value: "abc" } }), produced: "abc", valid: "abc", invalid: [] },
  longtext: { interact: () => fireEvent.change(input(), { target: { value: "long" } }), produced: "long", valid: "long", invalid: [] },
  number: { config: { min: 0, max: 10 }, interact: () => fireEvent.change(input(), { target: { value: "4" } }), produced: 4, valid: 4, invalid: [11, -1, "abc"] },
  email: { interact: () => fireEvent.change(input(), { target: { value: "a@b.co" } }), produced: "a@b.co", valid: "a@b.co", invalid: ["nope", "a@b"] },
  phone: { interact: () => fireEvent.change(input(), { target: { value: "+61 400 000 000" } }), produced: "+61 400 000 000", valid: "(02) 9000 0000", invalid: ["abc", "12", "+61 400 000 000 000 000"] },
  currency: { config: { min: 0 }, interact: () => fireEvent.change(input(), { target: { value: "12.5" } }), produced: 12.5, valid: 12.5, invalid: [-3, "x"] },
  date: { interact: () => fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-11-11" } }), produced: "2026-11-11", valid: "2026-02-28", invalid: ["2026-02-30", "11/11/2026", "tomorrow"] },
  time: { interact: () => fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: "09:30" } }), produced: "09:30", valid: "23:59", invalid: ["24:00", "9.30"] },
  datetime: { interact: () => fireEvent.change(document.querySelector('input[type="datetime-local"]')!, { target: { value: "2026-11-11T09:30" } }), produced: "2026-11-11T09:30", valid: "2026-11-11T09:30", invalid: ["2026-11-11", "2026-13-01T09:00"] },
  select: { config: { options: ["Red", "Blue"] }, interact: () => fireEvent.change(screen.getByRole("combobox"), { target: { value: "Blue" } }), produced: "Blue", valid: "Red", invalid: ["Green", 3] },
  multiselect: { config: { options: ["A", "B"] }, interact: () => fireEvent.click(screen.getByRole("button", { name: "B" })), produced: ["B"], valid: ["A", "B"], invalid: [["A", "C"]] },
  checkbox: { interact: () => fireEvent.click(screen.getByRole("checkbox")), produced: true, valid: true, invalid: [] },
  radio: { config: { options: ["Yes", "No"] }, interact: () => fireEvent.click(screen.getByRole("button", { name: "No" })), produced: "No", valid: "Yes", invalid: ["Maybe"] },
  yesno: { interact: () => fireEvent.click(screen.getByRole("button", { name: "Yes" })), produced: true, valid: false, invalid: [] },
  rating: { interact: () => fireEvent.click(screen.getByRole("button", { name: "3 star" })), produced: 3, valid: 5, invalid: [6, 0, 2.5] },
  slider: { config: { min: 0, max: 10 }, interact: () => fireEvent.change(screen.getByRole("slider"), { target: { value: "7" } }), produced: 7, valid: 10, invalid: [11, -1] },
  counter: { config: { min: 0, max: 3 }, interact: () => fireEvent.click(screen.getByRole("button", { name: "+" })), produced: 1, valid: 3, invalid: [4] },
  scale: { interact: () => fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } }), produced: 2, valid: 1, invalid: [6, 0] },
  photo: { config: { minPhotos: 1, maxFiles: 2 }, valid: null, invalid: [], upload: { valid: 2, invalid: 3 } },
  video: { config: { maxFiles: 1 }, valid: null, invalid: [], upload: { valid: 1, invalid: 2 } },
  file: { config: { maxFiles: 1 }, valid: null, invalid: [], upload: { valid: 1, invalid: 2 } },
  signature: { valid: "data:image/png;base64,AAAA", invalid: [] },
  temperature: { config: { min: 0, max: 8 }, interact: () => fireEvent.change(input(), { target: { value: "4.5" } }), produced: 4.5, valid: 4.5, invalid: [9] },
  barcode: { interact: () => fireEvent.change(input(), { target: { value: "9300633603443" } }), produced: "9300633603443", valid: "9300633603443", invalid: [] },
  location: { valid: { lat: -33.8, lng: 151.2 }, invalid: [] },
  instruction: { valid: undefined, invalid: [] },
};

afterEach(cleanup);

/** The server's full answer validation (core + extended rules) for this one question. */
function serverErrors(field: FormField, answer: unknown, uploadCount = 0) {
  const answers = answer === undefined ? {} : { q: answer };
  return collectFormErrors({ sections: [{ id: "s", title: "S", fields: [field] }] }, answers, { q: uploadCount }, {}, undefined, true, undefined, { extended: true })
    .filter((error) => error.fieldId === "q");
}

describe("field type audit", () => {
  it("has a case for every registered type", () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(FIELD_TYPES).sort());
  });

  it.each(Object.keys(FIELD_TYPES) as FormFieldType[])("%s: builder, renderer and server agree", (type) => {
    const testCase = CASES[type];
    // (a) builder definition: a new question of this type is savable.
    const fresh = makeField(type);
    expect(fresh.type).toBe(type);
    const field: FormField = { ...fresh, ...testCase.config, id: "q", label: "Question" };
    expect(validateFormSchemaForSave({ sections: [{ id: "s", title: "S", fields: [field] }] }).ok).toBe(true);

    // (b) renderer: renders the type and produces the answer shape the server reads.
    const answers: Record<string, unknown> = {};
    const onAnswer = vi.fn((id: string, value: unknown) => { answers[id] = value; });
    const uploads = testCase.upload ? { q: [] } : {};
    render(
      <FormRenderer
        mode={testCase.upload ? "sandbox" : "live"}
        schema={{ sections: [{ id: "s", title: "S", fields: [field] }] }}
        answers={{}}
        uploads={uploads}
        property={{}}
        onAnswer={onAnswer}
        onUpload={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Question").length).toBeGreaterThan(0);
    if (testCase.interact) {
      testCase.interact();
      expect(answers.q).toEqual(testCase.produced);
    }

    // (c) server validation: valid accepted, each invalid flagged.
    if (testCase.upload) {
      expect(serverErrors(field, undefined, testCase.upload.valid)).toEqual([]);
      expect(serverErrors(field, undefined, testCase.upload.invalid)[0]?.rule).toBe("max-files");
    } else {
      expect(serverErrors(field, testCase.valid)).toEqual([]);
      for (const bad of testCase.invalid) expect(serverErrors(field, bad).length, `${type} ${JSON.stringify(bad)}`).toBe(1);
    }
    if (type !== "instruction") {
      const required = { ...field, required: true };
      const errors = collectFormErrors({ sections: [{ id: "s", title: "S", fields: [required] }] }, {}, {}, {}, undefined, true, undefined, { extended: true });
      expect(errors.map((error) => error.fieldId)).toContain("q");
    }
  });

  it("accepts an 'Other' answer only when the question allows it", () => {
    const field = { type: "select", options: ["Red"], allowOther: true };
    expect(extendedFieldError(field, "select", "Purple", 0)).toBeNull();
    expect(extendedFieldError({ ...field, allowOther: false }, "select", "Purple", 0)?.rule).toBe("option");
    expect(extendedFieldError({ type: "multiselect", options: ["A"], allowOther: true }, "multiselect", ["A", "Typed"], 0)).toBeNull();
  });
});
