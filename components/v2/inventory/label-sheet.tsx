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
 * PAGES (board "Shelf labels", 2026-11-17): the sheet is drawn as real A4
 * pages (plain A4, 3 across, cut by hand, as before; owner default). Each page
 * is sized in container units (cqw) of its own width, so the on-screen preview
 * and the printed page have the same proportions: the preview is what prints.
 * "Many per page" puts 21 labels on a page (3 across, 7 down); "One per page"
 * gives each label its own page.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import type { BarcodeSymbology } from "@/lib/inventory/label-codes";

export interface PrintableLabel {
  code: string;
  itemName: string;
  propertyName?: string | null;
  unit?: string | null;
}

export type LabelLayout = "sheet" | "single";

/** Plain A4 with 10 mm margins: the printable area is 190 × 277 mm. */
export const LABELS_ACROSS = 3;
export const LABELS_DOWN = 7;
export const LABELS_PER_SHEET = LABELS_ACROSS * LABELS_DOWN;

/** Labels split into printed pages for a layout. */
export function labelPages<T>(labels: readonly T[], layout: LabelLayout): T[][] {
  const size = layout === "sheet" ? LABELS_PER_SHEET : 1;
  const pages: T[][] = [];
  for (let start = 0; start < labels.length; start += size) pages.push(labels.slice(start, start + size));
  return pages;
}

/** The line under the item name: where it goes and the unit ("Bondi Beach House · roll"). */
export function labelPlaceLine(label: Pick<PrintableLabel, "propertyName" | "unit">): string {
  return [label.propertyName || "Any property", label.unit].filter(Boolean).join(" · ");
}

function Barcode({ code, symbology, single }: { code: string; symbology: BarcodeSymbology; single: boolean }) {
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
    const svg = svgRef.current;
    if (!svg) return;
    try {
      JsBarcode(svg, code, {
        format: "CODE128",
        // No text from JsBarcode — the caption below is ours and says more.
        displayValue: false,
        height: 48,
        width: 1.6,
        margin: 0,
      });
      // Scale as a vector: a viewBox from JsBarcode's own size, then CSS sizes
      // it in page units, so the bars stay sharp on paper at any label size.
      const width = svg.getAttribute("width");
      const height = svg.getAttribute("height");
      if (width && height) {
        svg.setAttribute("viewBox", `0 0 ${parseFloat(width)} ${parseFloat(height)}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.removeAttribute("width");
        svg.removeAttribute("height");
      }
    } catch {
      // A code JsBarcode cannot encode still prints its caption, so the label
      // stays usable by hand rather than coming out blank.
    }
  }, [code, symbology]);

  if (symbology === "QR") {
    const size = single ? "h-[34cqw] w-[34cqw]" : "h-[17cqw] w-[17cqw]";
    return qrSrc ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={qrSrc} alt="" aria-hidden className={cn("shrink-0", size)} />
    ) : (
      <div className={cn("shrink-0", size)} />
    );
  }

  return <svg ref={svgRef} className={cn("w-full", single ? "h-[13cqw]" : "h-[7.5cqw]")} aria-hidden />;
}

function LabelCard({ label, symbology, layout }: { label: PrintableLabel; symbology: BarcodeSymbology; layout: LabelLayout }) {
  const single = layout === "single";
  const qr = symbology === "QR";
  return (
    <div
      className={cn(
        "sneek-label flex min-h-0 overflow-hidden border border-dashed border-black/30 bg-white text-black",
        single ? "mx-auto w-[60%] flex-col items-center gap-[1.4cqw] rounded-[0.6cqw] p-[3cqw] text-center" : "rounded-[0.5cqw] p-[1.4cqw]",
        !single && (qr ? "flex-row items-center gap-[1.4cqw]" : "flex-col justify-between"),
      )}
    >
      {qr && !single ? <Barcode code={label.code} symbology={symbology} single={single} /> : null}
      <div className={cn("min-w-0", !single && !qr && "w-full")}>
        <p className={cn("font-semibold leading-tight", single ? "text-[3.4cqw]" : "text-[2cqw]")}>{label.itemName}</p>
        <p className={cn("leading-tight text-black/70", single ? "text-[2.4cqw]" : "text-[1.45cqw]")}>{labelPlaceLine(label)}</p>
        {qr && !single ? <p className="mt-[0.4cqw] font-mono text-[1.45cqw] tracking-wider text-black/70">{label.code}</p> : null}
      </div>
      {!qr || single ? (
        <div className={cn("w-full", single && qr && "flex flex-col items-center")}>
          <Barcode code={label.code} symbology={symbology} single={single} />
          {/* The code in plain text. This is what someone reads down the
              phone when a label is too scuffed to scan. */}
          <p className={cn("mt-[0.5cqw] text-center font-mono tracking-wider text-black/70", single ? "text-[2.4cqw]" : "text-[1.45cqw]")}>{label.code}</p>
        </div>
      ) : null}
    </div>
  );
}

function Pages({ pages, symbology, layout, labelled }: { pages: PrintableLabel[][]; symbology: BarcodeSymbology; layout: LabelLayout; labelled: boolean }) {
  return (
    <>
      {pages.map((page, index) => (
        <div
          key={index}
          className="sneek-label-page mx-auto w-full bg-white shadow-[0_2px_10px_hsl(160_30%_10%/0.18)]"
          // On screen: A4 proportions with the 10 mm margins as padding. In
          // print the page is exactly the 190 × 277 mm printable area.
          style={{ aspectRatio: "210 / 297", padding: "4.76%", containerType: "inline-size" }}
          aria-label={labelled ? `Page ${index + 1} of ${pages.length}` : undefined}
          role={labelled ? "group" : undefined}
        >
          {layout === "sheet" ? (
            <div className="grid h-full gap-[1.6cqw]" style={{ gridTemplateColumns: `repeat(${LABELS_ACROSS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${LABELS_DOWN}, minmax(0, 1fr))` }}>
              {page.map((label) => <LabelCard key={label.code} label={label} symbology={symbology} layout={layout} />)}
              {/* Empty spaces on the last sheet, drawn faintly so the cut lines are clear. */}
              {Array.from({ length: LABELS_PER_SHEET - page.length }, (_, slot) => (
                <div key={`empty-${slot}`} aria-hidden className="rounded-[0.5cqw] border border-dashed border-black/10" />
              ))}
            </div>
          ) : (
            <div className="pt-[2cqw]">
              {page.map((label) => <LabelCard key={label.code} label={label} symbology={symbology} layout={layout} />)}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

const PRINT_CSS = `
  @media screen { .sneek-print-root { display: none !important; } }
  @media print {
    @page { size: A4; margin: 10mm; }
    html, body { background: #fff !important; }
    body > *:not(.sneek-print-root) { display: none !important; }
    .sneek-print-root { display: block !important; position: static; width: 190mm; margin: 0; padding: 0; }
    .sneek-print-root .sneek-label-page {
      width: 190mm !important;
      height: 277mm !important;
      aspect-ratio: auto !important;
      padding: 0 !important;
      margin: 0 !important;
      box-shadow: none !important;
      break-after: page;
      page-break-after: always;
    }
    .sneek-print-root .sneek-label-page:last-child { break-after: auto; page-break-after: auto; }
    .sneek-label { break-inside: avoid; page-break-inside: avoid; }
  }
`;

export function LabelSheet({
  labels,
  symbology = "CODE128",
  layout = "sheet",
  className,
}: {
  labels: PrintableLabel[];
  symbology?: BarcodeSymbology;
  /** "sheet" packs 21 per page (3 across); "single" gives each its own page. */
  layout?: LabelLayout;
  className?: string;
}) {
  const pages = labelPages(labels, layout);
  const [printRoot, setPrintRoot] = React.useState<HTMLElement | null>(null);

  // The printed copy lives directly under <body>, so nothing in the portal
  // shell (sidebar space, positioned or scrolling parents) can offset or clip
  // it; every other child of <body> is hidden while printing. The on-screen
  // preview beside it is the same pages at the same proportions.
  React.useEffect(() => {
    const root = document.createElement("div");
    root.className = "sneek-print-root";
    document.body.appendChild(root);
    setPrintRoot(root);
    return () => {
      root.remove();
    };
  }, []);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className={cn("sneek-label-preview flex flex-col gap-4", className)} aria-label={`Print preview: ${pages.length} A4 page${pages.length === 1 ? "" : "s"}`} role="group">
        <Pages pages={pages} symbology={symbology} layout={layout} labelled />
      </div>
      {printRoot ? createPortal(<div className="sneek-label-sheet"><Pages pages={pages} symbology={symbology} layout={layout} labelled={false} /></div>, printRoot) : null}
    </>
  );
}
