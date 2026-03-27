"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type SignaturePadProps = {
  label: string;
  value?: string;
  required?: boolean;
  onChange: (value: string) => void;
};

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 220;

export function SignaturePad({ label, value = "", required = false, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const renderedValueRef = useRef("");

  function getPoint(event: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function applyCanvasBaseStyles() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 3;
    return ctx;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = applyCanvasBaseStyles();
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  function commitValue() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nextValue = canvas.toDataURL("image/png");
    renderedValueRef.current = nextValue;
    onChange(nextValue);
  }

  useEffect(() => {
    clearCanvas();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = applyCanvasBaseStyles();
    if (!canvas || !ctx) return;
    if (!value) {
      renderedValueRef.current = "";
      clearCanvas();
      return;
    }
    if (renderedValueRef.current === value) return;

    clearCanvas();
    const image = new Image();
    image.onload = () => {
      clearCanvas();
      ctx.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      renderedValueRef.current = value;
    };
    image.src = value;
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-xs text-muted-foreground">
          {label}
          {required ? " *" : ""}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            clearCanvas();
            renderedValueRef.current = "";
            onChange("");
          }}
        >
          Clear
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-dashed border-border bg-white shadow-sm">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block h-40 w-full touch-none bg-white"
          onPointerDown={(event) => {
            const ctx = applyCanvasBaseStyles();
            const point = getPoint(event);
            if (!ctx || !point) return;
            drawingRef.current = true;
            ctx.beginPath();
            ctx.moveTo(point.x, point.y);
          }}
          onPointerMove={(event) => {
            if (!drawingRef.current) return;
            const ctx = applyCanvasBaseStyles();
            const point = getPoint(event);
            if (!ctx || !point) return;
            ctx.lineTo(point.x, point.y);
            ctx.stroke();
          }}
          onPointerUp={() => {
            if (!drawingRef.current) return;
            drawingRef.current = false;
            commitValue();
          }}
          onPointerLeave={() => {
            if (!drawingRef.current) return;
            drawingRef.current = false;
            commitValue();
          }}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">Sign with your finger or stylus. The signature will be saved with the form.</p>
    </div>
  );
}
