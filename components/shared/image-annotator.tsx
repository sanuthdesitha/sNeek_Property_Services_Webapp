"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, MapPin, Undo2, Trash2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Pt = { x: number; y: number }; // normalized 0..1
type Stroke = { color: string; points: Pt[] };
type Pin = { x: number; y: number; color: string };
export type AnnotationData = { strokes: Stroke[]; pins: Pin[] };

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#ffffff"];

/**
 * CORS-safe image annotator. The photo is shown as a plain <img> (display only)
 * and all drawing/pins live on a transparent overlay canvas. On save we export
 * ONLY the overlay (never the cross-origin image) at the photo's natural
 * resolution, so toBlob can never taint. The caller layers the returned overlay
 * PNG on top of the original to show the annotated result.
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
  const drawingRef = useRef(false);

  const [mode, setMode] = useState<"draw" | "pin">("draw");
  const [color, setColor] = useState(COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [comment, setComment] = useState(initialComment);
  const [order, setOrder] = useState<Array<"stroke" | "pin">>([]);

  useEffect(() => {
    if (open) {
      setStrokes([]);
      setPins([]);
      setOrder([]);
      setComment(initialComment);
      setMode("draw");
    }
  }, [open, initialComment, src]);

  // Match the canvas pixel size to the displayed image box so coordinates line up.
  const sizeCanvas = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const rect = img.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const s of strokes) {
      if (s.points.length < 1) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(2, w * 0.006);
      ctx.beginPath();
      s.points.forEach((p, i) => {
        const x = p.x * w;
        const y = p.y * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    pins.forEach((pin, i) => {
      const x = pin.x * w;
      const y = pin.y * h;
      const r = Math.max(10, w * 0.022);
      ctx.beginPath();
      ctx.fillStyle = pin.color;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
      ctx.fillStyle = "#000000";
      ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x, y + 1);
    });
  }, [strokes, pins]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => sizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open, sizeCanvas]);

  function toNorm(e: React.PointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const p = toNorm(e);
    if (mode === "pin") {
      setPins((prev) => [...prev, { ...p, color }]);
      setOrder((prev) => [...prev, "pin"]);
      return;
    }
    drawingRef.current = true;
    setStrokes((prev) => [...prev, { color, points: [p] }]);
    setOrder((prev) => [...prev, "stroke"]);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drawingRef.current || mode !== "draw") return;
    const p = toNorm(e);
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = { ...next[next.length - 1], points: [...next[next.length - 1].points, p] };
      return next;
    });
  }
  function endStroke() {
    drawingRef.current = false;
  }

  function undo() {
    const last = order[order.length - 1];
    if (!last) return;
    setOrder((prev) => prev.slice(0, -1));
    if (last === "stroke") setStrokes((prev) => prev.slice(0, -1));
    else setPins((prev) => prev.slice(0, -1));
  }
  function clearAll() {
    setStrokes([]);
    setPins([]);
    setOrder([]);
  }

  async function handleSave() {
    const img = imgRef.current;
    // Export overlay at the photo's natural resolution (fallback to displayed).
    const w = img?.naturalWidth || canvasRef.current?.width || 1024;
    const h = img?.naturalHeight || canvasRef.current?.height || 768;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const s of strokes) {
      if (s.points.length < 1) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(3, w * 0.006);
      ctx.beginPath();
      s.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x * w, p.y * h);
        else ctx.lineTo(p.x * w, p.y * h);
      });
      ctx.stroke();
    }
    pins.forEach((pin, i) => {
      const x = pin.x * w;
      const y = pin.y * h;
      const r = Math.max(14, w * 0.022);
      ctx.beginPath();
      ctx.fillStyle = pin.color;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
      ctx.fillStyle = "#000000";
      ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x, y + 1);
    });
    const blob: Blob | null = await new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
    if (!blob) return;
    await onSave({ blob, comment: comment.trim(), data: { strokes, pins } });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="text-sm">Mark up photo</DialogTitle>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setMode("draw")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${mode === "draw" ? "bg-primary text-primary-foreground" : ""}`}
            >
              <Pencil className="h-3.5 w-3.5" /> Draw
            </button>
            <button
              type="button"
              onClick={() => setMode("pin")}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${mode === "pin" ? "bg-primary text-primary-foreground" : ""}`}
            >
              <MapPin className="h-3.5 w-3.5" /> Pin
            </button>
          </div>
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-foreground" : "border-border"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" size="sm" variant="outline" onClick={undo} disabled={order.length === 0}>
              <Undo2 className="mr-1 h-3.5 w-3.5" /> Undo
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={clearAll} disabled={order.length === 0}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          </div>
        </div>

        <div className="relative mx-auto w-fit overflow-hidden rounded-lg border border-border bg-black/5" style={{ touchAction: "none" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={src}
            alt="Annotate"
            onLoad={sizeCanvas}
            className="block max-h-[55vh] w-auto max-w-full select-none"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Comment (shown to the cleaner)</Label>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="e.g. Streaks left on the mirror — re-clean and re-photograph."
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Save markup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
