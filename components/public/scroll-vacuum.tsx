"use client";

import { useEffect, useRef, useState } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";

/*
 * ─────────────────────────────────────────────────────────────────────────
 * ScrollVacuum — the signature scroll-driven hero piece.
 *
 * A vacuum cleaner travels from the RIGHT to the LEFT of the hero as the user
 * scrolls, with subtle rotation + scale for a 3D, weighty feel. Slow, eased,
 * Aman-like motion (no bounce).
 *
 * TWO RENDER MODES — it picks the best one automatically:
 *
 *   1. PRE-RENDERED IMAGE SEQUENCE (best quality, recommended for production):
 *      Drop frames into  public/vacuum/frame-0001.png … frame-0120.png
 *      then pass  framePattern="/vacuum/frame-%04d.png"  frameCount={120}.
 *      The component preloads them and scrubs the exact frame to a <canvas>
 *      based on scroll progress — a true pre-rendered 3D sequence.
 *
 *      To author the sequence: render your vacuum model (Blender/C4D/etc.)
 *      rotating + sliding right→left across a transparent background, export a
 *      PNG sequence, drop them in public/vacuum/. The %04d token is replaced by
 *      the 1-based, zero-padded frame index.
 *
 *   2. INLINE SVG FALLBACK (ships great immediately, no assets required):
 *      If no framePattern is given, OR any frame fails to load, we render a
 *      clean minimalist vacuum SVG that translates right→left and rotates/
 *      scales with scroll progress. This is the default today.
 *
 * prefers-reduced-motion: we skip the scroll scrubbing and render a calm static
 * end-state (vacuum resting at the left). Mobile gets a lighter, smaller travel.
 * ─────────────────────────────────────────────────────────────────────────
 */

interface ScrollVacuumProps {
  /** e.g. "/vacuum/frame-%04d.png". Omit to use the inline SVG fallback. */
  framePattern?: string;
  /** Number of frames in the sequence (1-based, zero-padded by %0Nd). */
  frameCount?: number;
  className?: string;
}

function buildFrameUrl(pattern: string, index: number): string {
  // Replace %0Nd / %d tokens with the zero-padded 1-based index.
  return pattern.replace(/%0?(\d*)d/g, (_match, widthStr: string) => {
    const width = widthStr ? parseInt(widthStr, 10) : 0;
    return String(index).padStart(width, "0");
  });
}

export function ScrollVacuum({
  framePattern,
  frameCount = 0,
  className = "",
}: ScrollVacuumProps) {
  const prefersReduced = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<HTMLImageElement[]>([]);
  const [sequenceReady, setSequenceReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Scrub progress: 0 when the hero is at the top of the viewport, 1 once it
  // has scrolled fully past. Spring-smoothed so the travel stays elegant.
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });
  const progress = useSpring(scrollYProgress, {
    stiffness: 80,
    damping: 24,
    restDelta: 0.001,
  });

  // ── Image-sequence preload (mode 1) ───────────────────────────────────
  useEffect(() => {
    if (!framePattern || frameCount <= 0 || prefersReduced) return;
    let cancelled = false;
    let loaded = 0;
    let failed = false;
    const images: HTMLImageElement[] = [];

    for (let i = 1; i <= frameCount; i += 1) {
      const img = new Image();
      img.src = buildFrameUrl(framePattern, i);
      img.onload = () => {
        loaded += 1;
        if (!cancelled && loaded === frameCount && !failed) {
          framesRef.current = images;
          setSequenceReady(true);
        }
      };
      img.onerror = () => {
        // Any missing frame → abandon the sequence, keep the SVG fallback.
        failed = true;
      };
      images[i - 1] = img;
    }

    return () => {
      cancelled = true;
    };
  }, [framePattern, frameCount, prefersReduced]);

  // ── Canvas scrubbing for the image sequence ───────────────────────────
  useEffect(() => {
    if (!sequenceReady || prefersReduced) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const draw = (p: number) => {
      const frames = framesRef.current;
      if (frames.length === 0) return;
      const idx = Math.min(
        frames.length - 1,
        Math.max(0, Math.round(p * (frames.length - 1)))
      );
      const img = frames[idx];
      if (!img?.complete) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // contain-fit the frame
      const scale = Math.min(w / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };

    draw(progress.get());
    const unsub = progress.on("change", draw);
    return () => unsub();
  }, [sequenceReady, prefersReduced, progress]);

  // ── SVG fallback transforms (mode 2) ──────────────────────────────────
  // Travel right → left across the hero. Mobile = lighter/smaller.
  const xRange = isMobile ? ["38%", "-38%"] : ["46%", "-46%"];
  const x = useTransform(progress, [0, 1], xRange);
  const rotate = useTransform(progress, [0, 0.5, 1], [8, -2, -10]);
  const scale = useTransform(progress, [0, 0.5, 1], [0.92, 1.04, 0.96]);
  const opacity = useTransform(progress, [0, 0.06, 0.9, 1], [0, 1, 1, 0.85]);

  const svgSize = isMobile ? 132 : 230;

  // Static end-state for reduced motion: vacuum resting at the left, level.
  const staticStyle = prefersReduced
    ? { x: xRange[1], rotate: -6, scale: 0.96, opacity: 1 }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className}`}
      aria-hidden="true"
    >
      {/* Mode 1: pre-rendered image sequence on a canvas */}
      {sequenceReady ? (
        <motion.canvas
          ref={canvasRef}
          className="absolute inset-x-0 top-1/2 h-[60%] w-full -translate-y-1/2"
          style={prefersReduced ? { opacity: 1 } : { opacity }}
        />
      ) : (
        // Mode 2: inline SVG vacuum that scrubs with scroll. Outer div centers
        // it (CSS), inner motion div carries the scroll-driven transforms so the
        // travel `x` does not clash with the centering translate.
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.div style={staticStyle ?? { x, rotate, scale, opacity }}>
            {/* soft contact shadow */}
            <motion.div
              className="absolute left-1/2 top-[78%] h-6 -translate-x-1/2 rounded-[50%] bg-[hsl(var(--foreground))]/15 blur-xl"
              style={{ width: svgSize * 0.7 }}
            />
            <VacuumSvg size={svgSize} />
          </motion.div>
        </div>
      )}
    </div>
  );
}

/**
 * Minimalist canister vacuum, drawn with brand-toned CSS variables so it adapts
 * to light/dark. Hex is permitted here per the design brief (it is SVG art).
 */
function VacuumSvg({ size = 220 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 220 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: "drop-shadow(0 18px 30px rgba(15,77,84,0.18))" }}
    >
      <defs>
        <linearGradient id="vac-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--primary))" />
          <stop offset="1" stopColor="hsl(var(--primary) / 0.78)" />
        </linearGradient>
        <linearGradient id="vac-accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(var(--accent))" />
          <stop offset="1" stopColor="hsl(var(--accent) / 0.7)" />
        </linearGradient>
        <radialGradient id="vac-light" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* hose sweeping up to the wand */}
      <path
        d="M150 92 C 188 70, 196 40, 168 26"
        stroke="hsl(var(--primary))"
        strokeOpacity="0.5"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray="2 11"
      />

      {/* wand + cleaning head (leading the travel, on the left) */}
      <g>
        <rect
          x="22"
          y="150"
          width="58"
          height="13"
          rx="6.5"
          fill="url(#vac-accent)"
        />
        <rect
          x="70"
          y="120"
          width="9"
          height="40"
          rx="4.5"
          fill="hsl(var(--primary))"
          transform="rotate(18 74 140)"
        />
      </g>

      {/* canister body */}
      <g>
        <rect
          x="92"
          y="70"
          width="96"
          height="78"
          rx="30"
          fill="url(#vac-body)"
        />
        {/* glossy highlight */}
        <rect
          x="92"
          y="70"
          width="96"
          height="78"
          rx="30"
          fill="url(#vac-light)"
        />
        {/* control dial */}
        <circle cx="140" cy="100" r="15" fill="hsl(var(--background))" opacity="0.9" />
        <circle cx="140" cy="100" r="15" stroke="hsl(var(--accent))" strokeWidth="3" />
        <line
          x1="140"
          y1="100"
          x2="140"
          y2="90"
          stroke="hsl(var(--primary))"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* vent slats */}
        <g stroke="hsl(var(--primary-foreground))" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round">
          <line x1="162" y1="118" x2="178" y2="118" />
          <line x1="162" y1="126" x2="178" y2="126" />
          <line x1="162" y1="134" x2="178" y2="134" />
        </g>
      </g>

      {/* wheels */}
      <circle cx="108" cy="150" r="13" fill="hsl(var(--foreground))" opacity="0.85" />
      <circle cx="108" cy="150" r="5" fill="hsl(var(--background))" />
      <circle cx="172" cy="150" r="13" fill="hsl(var(--foreground))" opacity="0.85" />
      <circle cx="172" cy="150" r="5" fill="hsl(var(--background))" />
    </svg>
  );
}
