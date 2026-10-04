import {expect,it} from "vitest";
import {reportDocumentStatus} from "@/lib/reports/document-status";
it("does not label missing submitted data as completed or final",()=>expect(reportDocumentStatus(null)).toContain("Draft preview — no submitted form; saved drafts are not included"));
it("does not equate a submitted historical form to QA approval",()=>expect(reportDocumentStatus({id:"historic"})).toBe("Submitted form record — QA approval is separate"));
