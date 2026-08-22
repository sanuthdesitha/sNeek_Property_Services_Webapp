"use client";

/**
 * PRINTABLE LABELS.
 *
 * The only screen in this system with genuinely physical constraints: these
 * come out of a printer, get stuck to a shelf in a damp cupboard, and are then
 * scanned at arm's length in bad light for years.
 *
 * WHAT THAT DICTATES:
 *
 * - The barcode renders as SVG, not canvas. A canvas barcode prints at screen
 *   resolution and the bars blur together on paper, which is the single most
 *   common reason a printed barcode will not scan.
 * - Every label carries HUMAN-READABLE text: the item, the property, and the
 *   code itself. A barcode nobody can read without a scanner is useless the
 *   moment the scanner fails, and it fails at the worst moment.
 * - `break-inside: avoid` on every label. A barcode split across a page break
 *   is not a barcode, and it is exactly the sort of thing nobody notices until
 *   a hundred sheets have printed.
 * - The print stylesheet strips the app chrome, because a shelf tag with a
 *   navigation sidebar printed beside it wastes half the page.
 *
 * TWO LAYOUTS, as asked: a sheet packing many labels onto one page for setting
 * up a property in one go, and one-per-page for a single replacement.
 */

import * as React from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { labelCaption, type BarcodeSymbology } from "@/lib/inventory/label-codes";

export interface PrintableLabel {
  code: string;
  itemName: string;
  propertyName?: string | null;
  unit?: string | null;
}

function Barcode({ code, symbology }: { code: string; symbology: BarcodeSymbology }) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [qrSrc, setQrSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (symbology === "QR") {
      // `margin: 1` rather than the default 4: a fat white quiet zone shrinks
      // the actual code on a small label until a phone struggles with it.
      QRCode.toDataURL(code, { width: 320, margin: 1 })
        .then(setQrSrc)
        .catch(() => setQrSrc(null));
      return;
    }
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, code, {
        format: "CODE128",
        // No text from JsBarcode — the caption below is ours and says more.
        displayValue: false,
        // Tall enough to stay readable when the label is applied at a slight
        // angle, which on a real shelf every one of them is.
        height: 48,
        width: 1.6,
        margin: 0,
      });
    } catch {
      // A code JsBarcode cannot encode still prints its caption, so the label
      // stays usable by hand rather than coming out blank.
    }
  }, [code, symbology]);

  if (symbology === "QR") {
    return qrSrc ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={qrSrc} alt="" aria-hidden className="h-[104px] w-[104px]" />
    ) : (
      <div className="h-[104px] w-[104px]" />
    );
  }

  return <svg ref={svgRef} className="h-[52px] w-full" aria-hidden />;
}

export function LabelSheet({
  labels,
  symbology = "CODE128",
  layout = "sheet",
}: {
  labels: PrintableLabel[];
  symbology?: BarcodeSymbology;
  /** "sheet" packs many per page; "single" gives each its own page. */
  layout?: "sheet" | "single";
}) {
  return (
    <>
      {/* Scoped to this component and only active while printing. Everything
          outside the sheet is hidden so a shelf tag does not come out with a
          sidebar printed next to it. */}
      <style>{`
        @media print {
          @page { margin: 10mm; }
          body * { visibility: hidden; }
          .sneek-label-sheet, .sneek-label-sheet * { visibility: visible; }
          .sneek-label-sheet {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .sneek-label {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .sneek-label--single {
            break-after: page;
            page-break-after: always;
          }
        }
      `}</style>

      <div
        className={
          "sneek-label-sheet " +
          (layout === "sheet" ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "flex flex-col gap-6")
        }
      >
        {labels.map((label) => (
          <div
            key={label.code}
            className={
              "sneek-label flex flex-col items-center gap-1 rounded border border-black/20 bg-white p-3 text-center text-black " +
              (layout === "single" ? "sneek-label--single" : "")
            }
          >
            <Barcode code={label.code} symbology={symbology} />
            <p className="mt-1 text-[0.8125rem] font-semibold leading-tight">{label.itemName}</p>
            <p className="text-[0.6875rem] leading-tight text-black/70">{labelCaption(label)}</p>
            {/* The code in plain text. This is what someone reads down the
                phone when a label is too scuffed to scan. */}
            <p className="font-mono text-[0.6875rem] tracking-wider text-black/60">{label.code}</p>
          </div>
        ))}
      </div>
    </>
  );
}
