import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormRenderer } from "@/components/v2/cleaner/form-renderer";
import { LAUNDRY_AREA_OPTIONS as options, LAUNDRY_AREA_STATUS as status, markNewJobLaundryArea, withLaundryAreaEvidence } from "@/lib/forms/laundry-area";
vi.mock("@/components/v2/cleaner/media-capture", () => ({ MediaCapture: ({ evidenceFieldId }: any) => <div data-testid="capture-field">{evidenceFieldId}</div> }));
afterEach(cleanup);
const schema = withLaundryAreaEvidence({ sections: [] }, markNewJobLaundryArea({ jobType: "AIRBNB_TURNOVER", isRework: false }));
function view(answers = {}) { return render(<FormRenderer schema={schema} answers={answers} uploads={{}} property={{}} inventoryStock={[]} onAnswer={vi.fn()} onUpload={vi.fn()} />); }
it("renders a dedicated area capture destination with the real form renderer", () => {
 view({ [status]: options[0] });
 expect(screen.getByTestId("capture-field")).toHaveTextContent("laundry-area-appliance-photo");
 expect(screen.getByText("Laundry area & appliances")).toBeInTheDocument();
});
it.each([options[1], options[2]])("does not demand fake evidence for %s", choice => {
 view({ [status]: choice });
 expect(screen.queryByTestId("capture-field")).toBeNull();
 expect(Boolean(screen.queryByText("Why was the laundry-area photo not taken?"))).toBe(choice === options[1]);
});
