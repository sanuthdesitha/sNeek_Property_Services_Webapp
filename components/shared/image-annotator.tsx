"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  MapPin,
  Undo2,
  Redo2,
  Trash2,
  Loader2,
  ArrowUpRight,
  Square,
  Type as TypeIcon,
  ZoomIn,
  ZoomOut,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Pt = { x: number; y: number }; // normalized 0..1 against the image
type Tool = "pen" | "arrow" | "box" | "pin" | "text";

type PenShape = { kind: "pen"; color: string; points: Pt[] };
type ArrowShape = { kind: "arrow"; color: string; from: Pt; to: Pt };
type BoxShape = { kind: "box"; color: string; from: Pt; to: Pt };
type PinShape = { kind: "pin"; color: string; at: Pt };
type TextShape = { kind: "text"; color: string; at: Pt; text: string };
type Shape = PenShape | ArrowShape | BoxShape | PinShape | TextShape;

export type AnnotationData = { shapes: Shape[] };

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Draw", icon: Pencil },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "box", label: "Box", icon: Square },
  { id: "pin", label: "Pin", icon: MapPin },
  { id: "text", label: "Text", icon: TypeIcon },
];

/** Render every shape onto a 2D context sized w×h (used for both the live
 *  overlay and the exported natural-resolution PNG). */
function paint(ctx: CanvasRenderingContext2D, w: number, h: number, shapes: Shape[], draft: Shape | null) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const lw = Math.max(2.5, w * 0.005);
  let pinNo = 0;
  const all = draft ? [...shapes, draft] : shapes;
  for (const s of all) {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lw;
    if (s.kind === "pen") {
      if (s.points.length < 1) continue;
      ctx.beginPath();
      s.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h)));
      ctx.stroke();
    } else if (s.kind === "box") {
      const x = Math.min(s.from.x, s.to.x) * w;
      const y = Math.min(s.from.y, s.to.y) * h;
      ctx.strokeRect(x, y, Math.abs(s.to.x - s.from.x) * w, Math.abs(s.to.y - s.from.y) * h);
    } else if (s.kind === "arrow") {
      const x1 = s.from.x * w, y1 = s.from.y * h, x2 = s.to.x * w, y2 = s.to.y * h;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(12, w * 0.018);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (s.kind === "pin") {
      pinNo += 1;
      const x = s.at.x * w, y = s.at.y * h, r = Math.max(11, w * 0.02);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, w * 0.0025);
      ctx.strokeStyle = "#000000";
      ctx.stroke();
      ctx.fillStyle = s.color === "#ffffff" ? "#000000" : "#ffffff";
      ctx.font = `bold ${Math.round(r * 1.15)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pinNo), x, y + 1);
    } else if (s.kind === "text" && s.text) {
      const x = s.at.x * w, y = s.at.y * h;
      const size = Math.max(14, w * 0.025);
      ctx.font = `bold ${Math.round(size)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const padding = size * 0.3;
      const metrics = ctx.measureText(s.text);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - padding, y - padding, metrics.width + padding * 2, size + padding * 2);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, x, y);
    }
  }
}

/**
 * Full-screen, CORS-safe image annotator. The photo is a plain <img> (display
 * only); all markup lives on a transparent overlay canvas. On save we export
 * ONLY the overlay at the photo's natural resolution, so toBlob can never taint.
 * Supports pen / arrow / box / numbered pin / text, colour, undo-redo, and
 * pinch-or-button zoom with pan.
 */
export function ImageAnnotator({
  src,
  open,
  onOpenChange,
  initialComment = "",
  saving = false,
  onSave,
}: {
  src: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialComment?: string;
  saving?: boolean;
  onSave: (result: { blob: Blob; comment: string; data: AnnotationData }) => void | Promise<void>;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<Shape | null>(null);
  const drawingRef = useRef(false);

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [comment, setComment] = useState(initialComment);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    if (open) {
      setShapes([]);
      setRedo([]);
      setComment(initialComment);
      setTool("pen");
      setColor(COLORS[0]);
      setZoom(1);
      draftRef.current = null;
    }
  }, [open, initialComment, src]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paint(ctx, canvas.width, canvas.height, shapes, draftRef.current);
  }, [shapes]);

  // Compute the contain-fit size of the image within the viewport, then the
  // stage is scaled by zoom (and the overflow-auto viewport handles panning).
  const computeFit = useCallback(() => {
    const img = imgRef.current;
    const vp = viewportRef.current;
    if (!img || !vp || !img.naturalWidth) return;
    const availW = vp.clientWidth - 24;
    const availH = vp.clientHeight - 24;
    const scale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight, 1) || 1;
    setFit({ w: Math.max(1, img.naturalWidth * scale), h: Math.max(1, img.naturalHeight * scale) });
  }, []);

  // Keep the canvas pixel size matched to the displayed (scaled) image box.
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const rect = img.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    redraw();
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [redraw, zoom, fit]);

  // Re-measure the canvas after the stage size (fit×zoom) settles.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => sizeCanvas());
    return () => cancelAnimationFrame(id);
  }, [open, fit, zoom, sizeCanvas]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      computeFit();
      sizeCanvas();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, computeFit, sizeCanvas]);

  function toNorm(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function commit(shape: Shape) {
    setShapes((prev) => [...prev, shape]);
    setRedo([]);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const p = toNorm(e);
    if (tool === "pin") {
      commit({ kind: "pin", color, at: p });
      return;
    }
    if (tool === "text") {
      const text = typeof window !== "undefined" ? window.prompt("Label text") : "";
      if (text && text.trim()) commit({ kind: "text", color, at: p, text: text.trim() });
      return;
    }
    drawingRef.current = true;
    if (tool === "pen") draftRef.current = { kind: "pen", color, points: [p] };
    else if (tool === "arrow") draftRef.current = { kind: "arrow", color, from: p, to: p };
    else if (tool === "box") draftRef.current = { kind: "box", color, from: p, to: p };
    redraw();
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drawingRef.current || !draftRef.current) return;
    const p = toNorm(e);
    const d = draftRef.current;
    if (d.kind === "pen") d.points.push(p);
    else if (d.kind === "arrow" || d.kind === "box") d.to = p;
    redraw();
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const d = draftRef.current;
    draftRef.current = null;
    if (!d) return;
    if (d.kind === "pen" && d.points.length < 2) {
      redraw();
      return;
    }
    if ((d.kind === "arrow" || d.kind === "box") && d.from.x === d.to.x && d.from.y === d.to.y) {
      redraw();
      return;
    }
    commit(d);
  }

  function undo() {
    setShapes((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedo((r) => [...r, last]);
      return prev.slice(0, -1);
    });
  }
  function redoAction() {
    setRedo((r) => {
      if (r.length === 0) return r;
      const last = r[r.length - 1];
      setShapes((prev) => [...prev, last]);
      return r.slice(0, -1);
    });
  }
  function clearAll() {
    setShapes([]);
    setRedo([]);
  }

  async function handleSave() {
    const img = imgRef.current;
    const w = img?.naturalWidth || canvasRef.current?.width || 1024;
    const h = img?.naturalHeight || canvasRef.current?.height || 768;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    paint(ctx, w, h, shapes, null);
    const blob: Blob | null = await new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
    if (!blob) return;
    await onSave({ blob, comment: comment.trim(), data: { shapes } });
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-neutral-950 text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <button type="button" onClick={() => onOpenChange(false)} className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Close">
          <X className="h-5 w-5" />
        </button>
        <span className="text-sm font-semibold">Mark up photo</span>
        <Button type="button" size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
          Save
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex rounded-lg bg-white/5 p-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              aria-pressed={tool === t.id}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ${tool === t.id ? "bg-primary text-primary-foreground" : "text-white/80 hover:bg-white/10"}`}
            >
              <t.icon className="h-4 w-4" /> <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => setColor(c)}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-white ring-2 ring-white/40" : "border-white/30"}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10" aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setZoom(1)} className="min-w-[3rem] rounded-md px-2 py-1 text-xs hover:bg-white/10" aria-label="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.25) * 100) / 100))} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10" aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-white/15" />
          <button type="button" onClick={undo} disabled={shapes.length === 0} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-40" aria-label="Undo">
            <Undo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={redoAction} disabled={redo.length === 0} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-40" aria-label="Redo">
            <Redo2 className="h-4 w-4" />
          </button>
          <button type="button" onClick={clearAll} disabled={shapes.length === 0} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/10 disabled:opacity-40" aria-label="Clear all">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div ref={viewportRef} className="relative flex-1 overflow-auto bg-neutral-900 p-3" style={{ touchAction: "none" }}>
        <div
          className="relative mx-auto"
          style={fit.w ? { width: fit.w * zoom, height: fit.h * zoom } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt="Annotate"
            onLoad={() => {
              computeFit();
              requestAnimationFrame(() => sizeCanvas());
            }}
            className="block h-full w-full select-none"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none"
            style={{ cursor: tool === "text" || tool === "pin" ? "copy" : "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>
      </div>

      {/* Comment + helper */}
      <div className="border-t border-white/10 px-3 py-2">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="Comment (shown to the cleaner) — e.g. Streaks on the mirror, re-clean and re-photograph."
          className="border-white/15 bg-white/5 text-white placeholder:text-white/40"
        />
      </div>
    </div>,
    document.body,
  );
}
